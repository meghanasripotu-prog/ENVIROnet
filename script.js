/* =========================================================
   ENVIRONMENTAL INTELLIGENCE NETWORK
   LOCATION SEARCH + SENSOR NODES
========================================================= */


/* =========================================================
   1. LIVE NODE CONFIG
========================================================= */

// EDIT THIS: the ESP32-S3's IP address on your hotspot,
// shown in the Serial Monitor when it boots (e.g. "http://192.168.43.147")
const ESP32_URL = "http://10.123.13.115";

// Matches the "id" of the live node object added below
const LIVE_NODE_ID = "HYD_CHEERYAL";

// How often (ms) to poll the ESP32-S3 for a fresh reading
const LIVE_POLL_INTERVAL_MS = 3000;

// Max readings kept for the live trend graph. The graph updates on
// EVERY poll, not on a fixed cycle — oldest point drops off as each
// new one comes in, so it's a continuously moving live plot.
const LIVE_GRAPH_MAX_POINTS = 40;

// EDIT THIS: free API key from https://www.weatherapi.com/signup.aspx
// (Sign up -> Dashboard -> copy the key shown at the top. Free tier:
// 1,000,000 calls/month, no credit card required, key is active
// almost immediately.)
const WEATHERAPI_KEY = "c3738640ee3b47aea3350556260909";

// How often (ms) to refresh temperature/humidity in the background.
// Weather doesn't change second-to-second like the water sensor does,
// so this is intentionally much slower than LIVE_POLL_INTERVAL_MS —
// keeps you well under the free quota. Clicking the node still fetches
// a fresh reading immediately, regardless of this interval.
const WEATHER_POLL_INTERVAL_MS = 5 * 60 * 1000;

// Tracks which node's panel is currently open, so live polling
// can refresh it in place without the user re-clicking
let currentlyOpenNodeId = null;


/* =========================================================
   2. SENSOR DATA
========================================================= */

const sensorNodes = [

    // ---------------------------------------------------
    // DEMO NODE — simulated data, illustrates what the full
    // network looks like at scale. Clearly labeled on the
    // dashboard so it's never confused with the live node.
    // ---------------------------------------------------
    {
        id: "HYD002",
        city: "Hyderabad",
        location: "Nizampet",
        lat: 17.5186,
        lng: 78.3788,
        hazards: ["Flood"],
        isDemo: true,
        temperature: 32,
        humidity: 79,
        waterLevel: 9.4,
        rainfall: 58,
        soilMoisture: 84,
        airQuality: 118,
        gasLevel: "Normal",
        smoke: "Low",
        risk: "HIGH",
        confidence: 94,
        status: "ONLINE"
    },

    // ---------------------------------------------------
    // REAL HARDWARE NODE — Arduino Mega + ultrasonic sensor
    // over LoRa to ESP32-S3. This is the only live node.
    // ---------------------------------------------------
    {
        id: "HYD_CHEERYAL",
        city: "Hyderabad",
        location: "Cheeryal Village (near ECIL)",
        // APPROXIMATE — replace with an exact drop-pin from Google Maps if you get one
        lat: 17.52,
        lng: 78.65,
        hazards: ["Flood"],
        isLive: true,
        waterUnit: "cm",       // real sensor reports centimeters, not feet
        temperature: null,     // not measured by this node
        humidity: null,
        waterLevel: 0,
        rainfall: null,
        soilMoisture: null,
        airQuality: null,
        gasLevel: null,
        smoke: null,
        risk: "LOW",
        confidence: 0,
        status: "CONNECTING",
        reason: "Waiting for first reading from the sensor node...",
        history: []             // filled in continuously as live readings arrive
    }

];


/* =========================================================
   3. MAP TILES — Standard OpenStreetMap (colorful light
   style: buildings, roads, parks — free, no API key needed)
========================================================= */

const mapTileURL =
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const mapAttribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';


/* =========================================================
   4. MAIN MAP
========================================================= */

const mainMap = L.map(
    "mainMap",
    {
        zoomControl: true,
        minZoom: 4,
        maxZoom: 19,
        worldCopyJump: true
    }
);


mainMap.setView(
    [17.3850, 78.4867],
    7
);


L.tileLayer(
    mapTileURL,
    {
        subdomains: ["a", "b", "c"],
        maxZoom: 19,

        attribution: mapAttribution
    }
).addTo(mainMap);


/* =========================================================
   5. SENSOR LAYERS
========================================================= */

const mainMarkerLayer =
    L.layerGroup().addTo(mainMap);


/* =========================================================
   6. SEARCH LOCATION MARKER
========================================================= */

let searchLocationMarker = null;


/* =========================================================
   7. RISK COLOR
========================================================= */

function getRiskColor(risk) {

    if (risk === "HIGH") {
        return "#ff4d5e";
    }

    if (risk === "MEDIUM") {
        return "#ffb020";
    }

    return "#2fd980";
}


/* =========================================================
   7.5 FIELD FORMATTER
   Shows "Not measured" for sensors the live node doesn't have,
   instead of literally printing "null" in the panel.
========================================================= */

function fmt(value, suffix) {

    if (value === null || value === undefined) {
        return "Not measured";
    }

    return value + (suffix || "");
}


/* =========================================================
   8. CREATE SENSOR MARKER
========================================================= */

function createSensorMarker(node) {

    const color =
        getRiskColor(node.risk);


    const marker =
        L.circleMarker(
            [node.lat, node.lng],
            {
                radius: 9,

                fillColor: color,

                color: "#ffffff",

                weight: 2,

                opacity: 1,

                fillOpacity: 0.9
            }
        );


    marker.bindTooltip(
        `
            <b>${node.location}</b>
            <br>
            ${node.city}
            <br>
            ${node.risk} RISK
        `,
        {
            direction: "top",
            offset: [0, -8]
        }
    );


    marker.on(
        "click",
        async function () {

            if (node.isLive) {

                // Fetch the water sensor (ESP32) and the weather API
                // (temperature/humidity) together, so the panel opens
                // with everything current at once.
                await Promise.all([
                    fetchLiveData(node),
                    fetchWeatherData(node)
                ]);

            }

            showNodeDetails(node);

        }
    );


    return marker;
}


/* =========================================================
   9. MAIN SENSOR MARKERS
========================================================= */

function updateMainMarkers() {

    mainMarkerLayer.clearLayers();


    const selectedHazards =
        Array.from(
            document.querySelectorAll(
                ".hazardFilter:checked"
            )
        ).map(
            function (checkbox) {
                return checkbox.value;
            }
        );


    let filteredNodes =
        sensorNodes;


    if (selectedHazards.length > 0) {

        filteredNodes =
            sensorNodes.filter(
                function (node) {

                    return selectedHazards.some(
                        function (hazard) {

                            return node.hazards.includes(
                                hazard
                            );

                        }
                    );

                }
            );

    }


    filteredNodes.forEach(
        function (node) {

            mainMarkerLayer.addLayer(
                createSensorMarker(node)
            );

        }
    );
}


/* =========================================================
   10. NODE INFORMATION
========================================================= */

function showNodeDetails(node) {

    currentlyOpenNodeId = node.id;

    const details =
        document.getElementById(
            "nodeDetails"
        );


    const riskColor =
        getRiskColor(node.risk);


    details.innerHTML = `

        <div class="node-card">

            <div class="node-header">

                <strong>
                    ${node.id}
                    ${node.isLive ? '<span class="live-tag">' + (node.status === "OFFLINE" ? "⚪ OFFLINE" : "🟢 LIVE") + '</span>' : ""}
                    ${node.isDemo ? '<span class="demo-tag">🔵 SIMULATED DEMO</span>' : ""}
                </strong>

                <span
                    style="
                        color:${riskColor};
                        font-weight:bold;
                    "
                >
                    ● ${node.risk} RISK
                </span>

            </div>


            <div class="node-location">

                📍 ${node.location},
                ${node.city}

            </div>


            <hr>


            <div class="node-grid">

                <div>
                    🌡 Temperature
                    <strong>
                        ${fmt(node.temperature, "°C")}
                    </strong>
                </div>


                <div>
                    💧 Humidity
                    <strong>
                        ${fmt(node.humidity, "%")}
                    </strong>
                </div>


                <div>
                    🌊 Water Level
                    <strong>
                        ${node.waterLevel} ${node.waterUnit || "ft"}
                    </strong>
                </div>


                <div>
                    🌧 Rainfall
                    <strong>
                        ${fmt(node.rainfall, " mm")}
                    </strong>
                </div>


                <div>
                    🌱 Soil Moisture
                    <strong>
                        ${fmt(node.soilMoisture, "%")}
                    </strong>
                </div>


                <div>
                    🌫 Air Quality
                    <strong>
                        ${node.airQuality === null || node.airQuality === undefined ? "Not measured" : "AQI " + node.airQuality}
                    </strong>
                </div>


                <div>
                    🏭 Gas Level
                    <strong>
                        ${fmt(node.gasLevel)}
                    </strong>
                </div>


                <div>
                    🔥 Smoke
                    <strong>
                        ${fmt(node.smoke)}
                    </strong>
                </div>

            </div>


            <hr>


            <div class="node-footer">

                <span>
                    📡 Status:
                    <strong>
                        ${node.status}
                    </strong>
                </span>


                <span>
                    🎯 Confidence:
                    <strong>
                        ${node.confidence}%
                    </strong>
                </span>

            </div>


            <div class="hazard-tags">

                ${node.hazards.map(
                    function (hazard) {

                        return `
                            <span>
                                ${hazard}
                            </span>
                        `;

                    }
                ).join("")}

            </div>

            ${node.isLive ? `
                <hr>
                <div class="live-panel">
                    <div class="live-reason">
                        💡 ${node.reason || "Waiting for first reading..."}
                    </div>
                    <div class="live-graph-label">
                        Water level trend (live, updates every ${LIVE_POLL_INTERVAL_MS / 1000}s)
                    </div>
                    <canvas id="liveTrendCanvas" width="260" height="90"></canvas>
                </div>
            ` : ""}

        </div>
    `;

    if (node.isLive) {

        const canvas =
            document.getElementById("liveTrendCanvas");

        if (canvas && node.history && node.history.length > 0) {
            drawLiveGraph(canvas, node.history);
        }
    }
}


/* =========================================================
   10.5 LIVE DATA INTEGRATION (ESP32-S3)
========================================================= */

// Fetches the latest reading from the ESP32-S3 gateway and
// writes it onto the given node. On failure, marks the node
// OFFLINE but keeps its last known values — no crash, no gap.
async function fetchLiveData(node) {

    try {

        const response =
            await fetch(
                ESP32_URL + "/data",
                { cache: "no-store" }
            );

        if (!response.ok) {
            throw new Error("Bad response from ESP32-S3");
        }

        const data =
            await response.json();

        node.waterLevel = data.waterLevel;
        node.risk = data.riskLabel;       // "LOW" | "MEDIUM" | "HIGH"
        node.confidence = data.confidence;
        node.status = data.status;        // "ONLINE" | "OFFLINE"
        node.reason = data.reason;

    }

    catch (error) {

        // ESP32-S3 unreachable (hotspot hiccup, node powered off, etc.)
        // — this is the graceful-degradation behavior, not a bug.
        node.status = "OFFLINE";
        node.reason =
            "Lost connection to the sensor node. Showing last known reading.";

    }
}


// Fetches current temperature + humidity from WeatherAPI.com for the
// given node's coordinates. Same graceful-degradation pattern as
// fetchLiveData above: on failure, the node just keeps whatever
// values it already had — no crash, no gap in the panel.
async function fetchWeatherData(node) {

    try {

        const url =
            "https://api.weatherapi.com/v1/current.json?key=" +
            WEATHERAPI_KEY +
            "&q=" + node.lat + "," + node.lng;

        const response =
            await fetch(url, { cache: "no-store" });

        if (!response.ok) {
            throw new Error("Bad response from WeatherAPI");
        }

        const data =
            await response.json();

        node.temperature = data.current.temp_c;
        node.humidity = data.current.humidity;

    }

    catch (error) {

        // WeatherAPI unreachable, key not active yet, rate-limited, etc.
        // — leave the node's last known temperature/humidity in place.
        console.error("WeatherAPI fetch failed:", error);

    }
}


// Draws a simple line graph of recent readings onto a canvas.
// No chart library — kept dependency-free on purpose.
function drawLiveGraph(canvas, history) {

    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) {

        ctx.fillStyle = "#8fa9c4";
        ctx.font = "11px Arial";
        ctx.fillText("Collecting readings...", 10, h / 2);
        return;
    }

    const values =
        history.map(function (p) { return p.value; });

    const minV = Math.min.apply(null, values);
    const maxV = Math.max.apply(null, values);
    const range = (maxV - minV) || 1;

    const padding = 8;
    const stepX = (w - padding * 2) / (history.length - 1);

    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach(function (point, i) {

        const x = padding + i * stepX;
        const y = h - padding - ((point.value - minV) / range) * (h - padding * 2);

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

    });

    ctx.stroke();

    // highlight the most recent point
    const lastValue = values[values.length - 1];
    const lastX = padding + (history.length - 1) * stepX;
    const lastY = h - padding - ((lastValue - minV) / range) * (h - padding * 2);

    ctx.fillStyle = "#2fd980";
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
}


/* =========================================================
   10.6 LIVE POLLING LOOP
========================================================= */

// Runs every LIVE_POLL_INTERVAL_MS: fetches a fresh reading,
// pushes it onto the node's history (sliding window, oldest point
// drops off), redraws the graph and map markers EVERY tick — no
// waiting for a batch cycle to complete.
async function pollLiveNode() {

    const liveNode =
        sensorNodes.find(
            function (n) { return n.id === LIVE_NODE_ID; }
        );

    if (!liveNode) {
        return;
    }

    await fetchLiveData(liveNode);

    if (!liveNode.history) {
        liveNode.history = [];
    }

    liveNode.history.push({
        t: Date.now(),
        value: liveNode.waterLevel
    });

    if (liveNode.history.length > LIVE_GRAPH_MAX_POINTS) {
        liveNode.history.shift();
    }

    // Keep map marker colors current every tick
    updateMainMarkers();

    // If this node's panel is currently open, refresh it in place —
    // this redraws the graph too, since showNodeDetails calls drawLiveGraph
    if (currentlyOpenNodeId === liveNode.id) {
        showNodeDetails(liveNode);
    }
}


/* =========================================================
   10.7 WEATHER POLLING LOOP (temperature + humidity)
========================================================= */

// Runs every WEATHER_POLL_INTERVAL_MS: refreshes temperature and
// humidity for the live node in the background, independent of the
// faster water-level poll above. Only redraws the panel if it's
// currently open, same pattern as pollLiveNode.
async function pollWeatherForLiveNode() {

    const liveNode =
        sensorNodes.find(
            function (n) { return n.id === LIVE_NODE_ID; }
        );

    if (!liveNode) {
        return;
    }

    await fetchWeatherData(liveNode);

    if (currentlyOpenNodeId === liveNode.id) {
        showNodeDetails(liveNode);
    }
}


/* =========================================================
   11. LOCATION SEARCH
========================================================= */

async function searchLocation() {

    const input =
        document.getElementById(
            "locationSearch"
        );


    const status =
        document.getElementById(
            "searchStatus"
        );


    const query =
        input.value.trim();


    if (query.length < 2) {

        status.className =
            "search-status error";

        status.textContent =
            "Please enter a location.";

        return;
    }


    status.className =
        "search-status loading";

    status.textContent =
        "🔍 Searching for " +
        query +
        "...";


    try {

        const url =
            "https://nominatim.openstreetmap.org/search?" +
            new URLSearchParams({

                q: query,

                format: "jsonv2",

                limit: "5",

                countrycodes: "in",

                addressdetails: "1"

            });


        const response =
            await fetch(url);


        if (!response.ok) {

            throw new Error(
                "Location search failed"
            );

        }


        const results =
            await response.json();


        if (results.length === 0) {

            status.className =
                "search-status error";

            status.textContent =
                "❌ Location not found in India.";

            return;
        }


        const place =
            results[0];


        const lat =
            parseFloat(place.lat);


        const lng =
            parseFloat(place.lon);


        let zoom = 12;


        if (place.type === "country") {

            zoom = 5;

        }

        else if (place.type === "state") {

            zoom = 7;

        }

        else if (
            place.type === "state_district" ||
            place.type === "county"
        ) {

            zoom = 9;

        }

        else if (
            place.type === "city" ||
            place.type === "town"
        ) {

            zoom = 12;

        }

        else if (place.type === "village") {

            zoom = 13;

        }


        mainMap.flyTo(
            [lat, lng],
            zoom,
            {
                duration: 1.5
            }
        );


        showSearchLocation(
            lat,
            lng,
            place.display_name
        );


        status.className =
            "search-status success";


        status.textContent =
            "📍 " +
            place.display_name;

    }


    catch (error) {

        console.error(error);


        status.className =
            "search-status error";


        status.textContent =
            "❌ Unable to search location. Check your internet connection.";

    }
}


/* =========================================================
   12. SHOW SEARCH LOCATION
========================================================= */

function showSearchLocation(
    lat,
    lng,
    name
) {

    if (searchLocationMarker) {

        mainMap.removeLayer(
            searchLocationMarker
        );

    }


    searchLocationMarker =
        L.marker(
            [lat, lng]
        ).addTo(mainMap);


    searchLocationMarker
        .bindPopup(
            `
                <strong>
                    📍 Selected Location
                </strong>

                <br><br>

                ${name}
            `
        )
        .openPopup();
}


/* =========================================================
   13. SEARCH BUTTON
========================================================= */

document
    .getElementById(
        "searchLocationBtn"
    )
    .addEventListener(
        "click",
        searchLocation
    );


/* =========================================================
   14. ENTER KEY
========================================================= */

document
    .getElementById(
        "locationSearch"
    )
    .addEventListener(
        "keydown",
        function (event) {

            if (event.key === "Enter") {

                searchLocation();

            }

        }
    );


/* =========================================================
   15. HAZARD FILTERS
========================================================= */

document
    .querySelectorAll(
        ".hazardFilter"
    )
    .forEach(
        function (checkbox) {

            checkbox.addEventListener(
                "change",
                function () {

                    updateMainMarkers();

                }
            );

        }
    );


/* =========================================================
   16. MAP SIZE FIX
========================================================= */

setTimeout(
    function () {

        mainMap.invalidateSize();

    },
    1000
);


/* =========================================================
   17. INITIALIZE
========================================================= */

updateMainMarkers();

showNodeDetails(
    sensorNodes[0]
);

// Start live polling of the ESP32-S3 gateway (water level)
pollLiveNode();
setInterval(pollLiveNode, LIVE_POLL_INTERVAL_MS);

// Start live polling of WeatherAPI.com (temperature + humidity)
pollWeatherForLiveNode();
setInterval(pollWeatherForLiveNode, WEATHER_POLL_INTERVAL_MS);


/* =========================================================
   18. CONSOLE
========================================================= */

console.log(
    "Environmental Intelligence Network: ONLINE"
);

console.log(
    "Location Search: ONLINE"
);

console.log(
    "Sensor Nodes:",
    sensorNodes.length
);