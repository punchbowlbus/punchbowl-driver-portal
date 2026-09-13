/**
 * Charter Map — Google Maps integration for itinerary stops.
 * Provides Places Autocomplete, route calculation, and polyline display.
 */
import { GOOGLE_MAPS_API_KEY } from "./config.js";

let map = null;
let directionsService = null;
let directionsRenderer = null;
let markers = [];
let autocompleteInstances = new Map();
let routeResult = null;
let mapInitialised = false;
let mapLoadPromise = null;

const SYDNEY_CENTER = { lat: -33.8688, lng: 151.2093 };

/* =========================================================
   Google Maps script loader
========================================================= */
function loadGoogleMapsScript() {
  if (mapLoadPromise) return mapLoadPromise;
  if (window.google?.maps?.Map) return Promise.resolve();

  mapLoadPromise = new Promise((resolve, reject) => {
    if (GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
      reject(new Error("Google Maps API key not configured. Update config.js with your API key."));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places,geometry&callback=__charterMapReady`;
    script.async = true;
    script.defer = true;
    window.__charterMapReady = () => {
      delete window.__charterMapReady;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });

  return mapLoadPromise;
}

/* =========================================================
   Map initialisation
========================================================= */
export async function initMap(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    await loadGoogleMapsScript();
  } catch (error) {
    container.innerHTML = `<div style="display:grid;place-items:center;height:100%;padding:20px;text-align:center;color:#64748b;">
      <div><strong style="color:#c62828;">⚠ Maps unavailable</strong><br><small>${error.message}</small></div>
    </div>`;
    return;
  }

  map = new google.maps.Map(container, {
    center: SYDNEY_CENTER,
    zoom: 11,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    styles: [
      { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
      { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] }
    ]
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    polylineOptions: { strokeColor: "#c62828", strokeWeight: 5, strokeOpacity: 0.85 }
  });

  mapInitialised = true;
}

/* =========================================================
   Places Autocomplete — attach to a stop input
========================================================= */
export function attachAutocomplete(inputElement, onPlaceSelected) {
  if (!window.google?.maps?.places) return null;

  // Avoid re-attaching
  if (autocompleteInstances.has(inputElement)) return autocompleteInstances.get(inputElement);

  const autocomplete = new google.maps.places.Autocomplete(inputElement, {
    componentRestrictions: { country: "au" },
    fields: ["place_id", "geometry", "formatted_address", "name"]
  });

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place?.geometry?.location) return;

    const data = {
      placeId: place.place_id || "",
      latitude: place.geometry.location.lat(),
      longitude: place.geometry.location.lng(),
      formattedAddress: place.formatted_address || place.name || inputElement.value,
      name: place.name || place.formatted_address || inputElement.value
    };

    // Update the input display value
    inputElement.value = data.formattedAddress;

    if (typeof onPlaceSelected === "function") onPlaceSelected(data);
  });

  autocompleteInstances.set(inputElement, autocomplete);
  return autocomplete;
}

/* =========================================================
   Detach autocomplete when stops are rebuilt
========================================================= */
export function detachAllAutocomplete() {
  autocompleteInstances.forEach((ac, input) => {
    google.maps.event.clearInstanceListeners(ac);
  });
  autocompleteInstances.clear();
}

/* =========================================================
   Route calculation
========================================================= */
let routeDebounceTimer = null;

export function calculateRoute(stops, callback) {
  clearTimeout(routeDebounceTimer);
  routeDebounceTimer = setTimeout(() => _doCalculateRoute(stops, callback), 400);
}

async function _doCalculateRoute(stops, callback) {
  if (!directionsService || !directionsRenderer || !map) {
    if (typeof callback === "function") callback(null, "Map not initialised");
    return;
  }

  // Need at least 2 geocoded stops
  const geocoded = stops.filter((s) => s.latitude && s.longitude);
  if (geocoded.length < 2) {
    directionsRenderer.setDirections({ routes: [] });
    clearMarkers();
    routeResult = null;
    if (typeof callback === "function") callback(null, "Need at least 2 geocoded stops");
    return;
  }

  const origin = { lat: geocoded[0].latitude, lng: geocoded[0].longitude };
  const destination = { lat: geocoded[geocoded.length - 1].latitude, lng: geocoded[geocoded.length - 1].longitude };
  const waypoints = geocoded.slice(1, -1).map((s) => ({
    location: { lat: s.latitude, lng: s.longitude },
    stopover: true
  }));

  try {
    const result = await directionsService.route({
      origin,
      destination,
      waypoints,
      travelMode: google.maps.TravelMode.DRIVING,
      optimizeWaypoints: false
    });

    directionsRenderer.setDirections(result);

    // Extract route summary
    const route = result.routes[0];
    let totalDistanceM = 0;
    let totalDurationS = 0;
    const legs = [];

    route.legs.forEach((leg, i) => {
      totalDistanceM += leg.distance.value;
      totalDurationS += leg.duration.value;
      legs.push({
        from: leg.start_address,
        to: leg.end_address,
        distanceKm: Math.round(leg.distance.value / 100) / 10,
        durationMinutes: Math.round(leg.duration.value / 60)
      });
    });

    routeResult = {
      distanceKm: Math.round(totalDistanceM / 100) / 10,
      durationMinutes: Math.round(totalDurationS / 60),
      encodedPolyline: route.overview_polyline,
      legs
    };

    if (typeof callback === "function") callback(routeResult, null);
  } catch (error) {
    console.error("Route calculation failed:", error);
    routeResult = null;
    if (typeof callback === "function") callback(null, error?.message || "Route calculation failed");
  }
}

/* =========================================================
   Markers (used if Directions renderer is not active)
========================================================= */
function clearMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
}

export function addMarker(lat, lng, label) {
  if (!map) return null;
  const marker = new google.maps.Marker({
    position: { lat, lng },
    map,
    label: label ? { text: String(label), color: "#fff", fontWeight: "bold" } : undefined
  });
  markers.push(marker);
  return marker;
}

/* =========================================================
   Static map URL for PDF
========================================================= */
export function getStaticMapUrl(stops, width = 600, height = 300) {
  if (GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") return null;

  const geocoded = stops.filter((s) => s.latitude && s.longitude);
  if (geocoded.length < 2) return null;

  const markers_param = geocoded.map((s, i) =>
    `markers=color:red%7Clabel:${i + 1}%7C${s.latitude},${s.longitude}`
  ).join("&");

  let pathParam = "";
  if (routeResult?.encodedPolyline) {
    pathParam = `&path=enc:${routeResult.encodedPolyline}`;
  } else {
    const pathCoords = geocoded.map((s) => `${s.latitude},${s.longitude}`).join("|");
    pathParam = `&path=color:0xc62828ff|weight:4|${pathCoords}`;
  }

  return `https://maps.googleapis.com/maps/api/staticmap?size=${width}x${height}&maptype=roadmap&${markers_param}${pathParam}&key=${GOOGLE_MAPS_API_KEY}`;
}

/* =========================================================
   Click-to-pin: register map click handler
========================================================= */
let clickMarker = null;

export function onMapClick(callback) {
  if (!map) return;
  map.addListener("click", async (event) => {
    const lat = event.latLng.lat();
    const lng = event.latLng.lng();

    // Place/move a temporary marker
    if (clickMarker) clickMarker.setMap(null);
    clickMarker = new google.maps.Marker({
      position: { lat, lng },
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#c62828",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 2
      },
      title: "Selected location"
    });

    // Reverse geocode
    try {
      const data = await reverseGeocode(lat, lng);
      if (typeof callback === "function") callback(data);
    } catch (err) {
      console.warn("Reverse geocode failed:", err);
    }
  });
}

export async function reverseGeocode(lat, lng) {
  const geocoder = new google.maps.Geocoder();
  const response = await geocoder.geocode({ location: { lat, lng } });
  const result = response.results?.[0];
  if (!result) throw new Error("No geocode results");

  return {
    placeId: result.place_id || "",
    latitude: lat,
    longitude: lng,
    formattedAddress: result.formatted_address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    name: result.formatted_address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  };
}

/* =========================================================
   Getters
========================================================= */
export function getRouteResult() { return routeResult; }
export function isMapReady() { return mapInitialised; }
export function getMap() { return map; }
