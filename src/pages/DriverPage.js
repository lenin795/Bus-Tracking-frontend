import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { MapPin, Play, Square, LogOut, AlertCircle, Map as MapIconLucide, Satellite, Route as RouteIcon, Wifi, WifiOff } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import api from '../services/api';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const busIcon = new L.divIcon({
  html: '<div style="background:#3B82F6;border-radius:50%;width:35px;height:35px;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"><span style="color:white;font-size:22px;">🚌</span></div>',
  className: '',
  iconSize: [35, 35],
  iconAnchor: [17, 17]
});

const routeStopIcon = new L.divIcon({
  html: '<div style="background:#10B981;border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>',
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const firstStopIcon = new L.divIcon({
  html: '<div style="background:#3B82F6;border:3px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 6px rgba(59,130,246,0.6);"></div>',
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const lastStopIcon = new L.divIcon({
  html: '<div style="background:#EF4444;border:3px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 6px rgba(239,68,68,0.6);"></div>',
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

// ─── Fit the map to all stop bounds exactly once on mount ───────────────────
function FitBounds({ stops }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || !stops || stops.length < 2) return;
    const bounds = L.latLngBounds(
      stops.map(s => [s.location.latitude, s.location.longitude])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    fitted.current = true;
  }, [stops, map]);

  return null;
}

// ─── Pan to bus only when trip is active, and only when bus actually moves ──
function FollowBus({ center, active }) {
  const map = useMap();
  const lastCenter = useRef(null);

  useEffect(() => {
    if (!active || !center) return;
    if (lastCenter.current) {
      const [prevLat, prevLng] = lastCenter.current;
      // Skip pan if movement is less than ~20 metres (avoids jitter)
      if (Math.abs(center[0] - prevLat) < 0.0002 && Math.abs(center[1] - prevLng) < 0.0002) return;
    }
    map.panTo(center, { animate: true, duration: 0.8 });
    lastCenter.current = center;
  }, [center, active, map]);

  return null;
}

const DriverPage = () => {
  const { user, logout } = useAuth();
  const [bus, setBus] = useState(null);
  const [trip, setTrip] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [location, setLocation] = useState(null);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mapType, setMapType] = useState('street');

  // Array of coordinate arrays — one per consecutive stop pair
  const [routeSegments, setRouteSegments] = useState([]);
  const [totalRouteDistance, setTotalRouteDistance] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  const socketRef = useRef(null);
  const watchIdRef = useRef(null);
  const busRef = useRef(null);
  const isActiveTripRef = useRef(false);

  useEffect(() => { busRef.current = bus; }, [bus]);
  useEffect(() => { isActiveTripRef.current = !!trip; }, [trip]);

  useEffect(() => {
    fetchBus();

    const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    socketRef.current.on('connect', () => {
      setSocketConnected(true);
      if (isActiveTripRef.current && busRef.current) {
        socketRef.current.emit('driver:start-sharing', {
          busId: busRef.current._id,
          driverId: user.id
        });
      }
    });

    socketRef.current.on('disconnect', () => setSocketConnected(false));
    socketRef.current.on('connect_error', () => setSocketConnected(false));
    socketRef.current.on('driver:sharing-started', (data) => {
      console.log('✅ Sharing confirmed:', data);
    });

    return () => {
      stopSharingWithRef();
      if (socketRef.current) socketRef.current.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bus?.route?.stops?.length >= 2) {
      fetchRouteSegments(bus.route.stops);
    }
  }, [bus]);

  /**
   * Fetch road geometry for each CONSECUTIVE stop pair in order:
   *   stop[0] → stop[1],  stop[1] → stop[2], ..., stop[n-1] → stop[n]
   *
   * WHY per-segment (not one bulk request):
   *   OSRM's bulk waypoint routing can reorder or shortcut through waypoints
   *   to find the globally "optimal" path, which causes the drawn polyline
   *   to skip stops, zigzag, or appear to go in both directions.
   *   Fetching each pair individually guarantees:
   *     1. Every stop is visited in the defined order
   *     2. Each road path is the shortest between two adjacent stops
   *     3. The overall route is strictly one-directional (start → end)
   */
  const fetchRouteSegments = async (stops) => {
    setRouteLoading(true);
    setRouteSegments([]); // clear old route while fetching

    const segments = [];
    let totalKm = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to   = stops[i + 1];

      try {
        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${from.location.longitude},${from.location.latitude};` +
          `${to.location.longitude},${to.location.latitude}` +
          `?overview=full&geometries=geojson`;

        const res  = await fetch(url);
        const data = await res.json();

        if (data.code === 'Ok' && data.routes?.[0]) {
          // OSRM returns [lng, lat] — Leaflet needs [lat, lng]
          const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          segments.push(coords);
          totalKm += data.routes[0].distance / 1000;
        } else {
          // Fallback: straight line between the two stops
          segments.push([
            [from.location.latitude, from.location.longitude],
            [to.location.latitude,   to.location.longitude]
          ]);
        }
      } catch {
        segments.push([
          [from.location.latitude, from.location.longitude],
          [to.location.latitude,   to.location.longitude]
        ]);
      }

      // Update segments progressively so user sees the route appear stop by stop
      setRouteSegments([...segments]);
    }

    setTotalRouteDistance(totalKm.toFixed(2));
    setRouteLoading(false);
  };

  const fetchBus = async () => {
    try {
      const response = await api.get('/driver/my-bus');
      setBus(response.data.bus);
      try {
        const tripResponse = await api.get('/driver/current-trip');
        if (tripResponse.data.trip) {
          setTrip(tripResponse.data.trip);
          startSharing(response.data.bus);
        }
      } catch {
        // no active trip — normal
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch bus');
    } finally {
      setLoading(false);
    }
  };

  const startTrip = async () => {
    try {
      const response = await api.post('/driver/start-trip', { busId: bus._id });
      setTrip(response.data.trip);
      startSharing(bus);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start trip');
    }
  };

  const endTrip = async () => {
    try {
      await api.post('/driver/end-trip', { tripId: trip._id });
      setTrip(null);
      stopSharingWithRef();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to end trip');
    }
  };

  const startSharing = (busData) => {
    const targetBus = busData || busRef.current;
    if (!targetBus) return;
    if (!navigator.geolocation) { setError('Geolocation not supported'); return; }

    setIsSharing(true);
    socketRef.current.emit('driver:start-sharing', {
      busId: targetBus._id,
      driverId: user.id
    });

    let prevPosition  = null;
    let prevTimestamp = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed: gpsSpeed } = position.coords;
        setLocation({ latitude, longitude, timestamp: new Date() });

        let speedKmh = gpsSpeed ? gpsSpeed * 3.6 : 0;
        if (speedKmh === 0 && prevPosition && prevTimestamp) {
          const dtHours = (position.timestamp - prevTimestamp) / 3600000;
          if (dtHours > 0) {
            const R    = 6371;
            const dLat = (latitude - prevPosition.latitude)  * Math.PI / 180;
            const dLon = (longitude - prevPosition.longitude) * Math.PI / 180;
            const a    = Math.sin(dLat / 2) ** 2 +
              Math.cos(prevPosition.latitude * Math.PI / 180) *
              Math.cos(latitude * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
            speedKmh = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / dtHours;
          }
        }
        prevPosition  = { latitude, longitude };
        prevTimestamp = position.timestamp;
        setSpeed(Math.min(speedKmh, 200).toFixed(1));

        if (socketRef.current?.connected) {
          socketRef.current.emit('driver:location-update', {
            busId: targetBus._id,
            latitude,
            longitude,
            speed: speedKmh,
            heading: position.coords.heading || 0
          });
        }

        api.post('/driver/save-location', {
          busId: targetBus._id, latitude, longitude, speed: speedKmh
        }).catch(console.error);
      },
      (err) => setError('Location error: ' + err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const stopSharingWithRef = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    const currentBus = busRef.current;
    if (socketRef.current && currentBus) {
      socketRef.current.emit('driver:stop-sharing', { busId: currentBus._id });
    }
    setIsSharing(false);
  };

  const toggleMapType = () => setMapType(prev => prev === 'street' ? 'satellite' : 'street');

  const getTileLayerUrl = () =>
    mapType === 'satellite'
      ? 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const getTileLayerAttribution = () =>
    mapType === 'satellite'
      ? '&copy; <a href="https://www.google.com/maps">Google Maps</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!bus) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">No Bus Assigned</h2>
          <p className="text-gray-600 mb-4">Please contact admin to assign you a bus</p>
          <button onClick={logout} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg">Logout</button>
        </div>
      </div>
    );
  }

  const stops    = bus.route?.stops || [];
  const busCenter = location ? [location.latitude, location.longitude] : null;

  // Default map center = middle stop of the route
  const defaultCenter = stops.length > 0
    ? [
        stops[Math.floor(stops.length / 2)].location.latitude,
        stops[Math.floor(stops.length / 2)].location.longitude
      ]
    : [11.0, 78.0];

  const renderStopMarker = (stop, index) => {
    const isFirst = index === 0;
    const isLast  = index === stops.length - 1;
    const icon    = isFirst ? firstStopIcon : isLast ? lastStopIcon : routeStopIcon;
    return (
      <Marker
        key={stop._id}
        position={[stop.location.latitude, stop.location.longitude]}
        icon={icon}
      >
        <Popup>
          <div style={{ minWidth: 140 }}>
            <strong>Stop {index + 1}: {stop.stopName}</strong><br />
            <span style={{ color: '#6B7280', fontSize: 12 }}>{stop.stopCode}</span>
            {isFirst && <><br /><span style={{ color: '#3B82F6', fontWeight: 700 }}>🟢 Start</span></>}
            {isLast  && <><br /><span style={{ color: '#EF4444', fontWeight: 700 }}>🔴 End</span></>}
          </div>
        </Popup>
      </Marker>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Header ── */}
      <div className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Driver Dashboard</h1>
            <p className="text-gray-600">Welcome, {user.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full ${
              socketConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {socketConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {socketConnected ? 'Connected' : 'Reconnecting...'}
            </div>
            <button onClick={logout} className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg">
              <LogOut size={20} />
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2"><AlertCircle size={20} />{error}</div>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* ── Bus Info Card ── */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{bus.busName}</h2>
              <p className="text-gray-600">Bus Number: {bus.busNumber}</p>
              <p className="text-gray-600">Route: {bus.route?.routeName}</p>

              {routeLoading && (
                <p className="text-sm text-blue-500 mt-1 flex items-center gap-1.5">
                  <span className="animate-spin inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></span>
                  Calculating road route...
                </p>
              )}
              {totalRouteDistance && !routeLoading && (
                <p className="text-sm text-blue-600 mt-1 flex items-center gap-1">
                  <RouteIcon size={14} />
                  Total Route: {totalRouteDistance} km ({stops.length} stops)
                </p>
              )}
              {stops.length >= 2 && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-600 flex-wrap">
                  <span className="inline-block w-3 h-3 bg-blue-500 rounded-full shrink-0"></span>
                  <span className="font-medium">{stops[0].stopName}</span>
                  <span className="text-gray-400">→</span>
                  <span className="inline-block w-3 h-3 bg-red-500 rounded-full shrink-0"></span>
                  <span className="font-medium">{stops[stops.length - 1].stopName}</span>
                </div>
              )}
            </div>

            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-white font-semibold ${
              isSharing ? 'bg-green-500' : 'bg-gray-400'
            }`}>
              {isSharing && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
              )}
              {isSharing ? 'Live' : 'Offline'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── MAP PANEL ── */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <MapPin className="text-blue-600" size={24} />
                {isSharing ? 'Live Location' : 'Route Preview'}
              </h2>
              <button
                onClick={toggleMapType}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                {mapType === 'street'
                  ? <><Satellite size={18} /><span className="text-sm font-semibold">Satellite</span></>
                  : <><MapIconLucide size={18} /><span className="text-sm font-semibold">Street</span></>}
              </button>
            </div>

            <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
              {stops.length >= 2 ? (
                /**
                 * KEY DECISIONS:
                 *
                 * 1. key="driver-map-stable" — never changes, so the MapContainer
                 *    is never unmounted/remounted. Without this, React would destroy
                 *    and recreate the map on every state change (location, speed, etc.)
                 *    which resets zoom and center every GPS tick.
                 *
                 * 2. FitBounds — runs once after mount to zoom/fit all stops.
                 *    Uses a ref flag so it only fires once even if stops prop re-renders.
                 *
                 * 3. FollowBus — only pans when isSharing=true AND the bus
                 *    moves more than ~20m. Before trip start, map stays on route.
                 *
                 * 4. routeSegments map — renders one <Polyline> per stop pair.
                 *    Each segment is the shortest road path between two adjacent stops,
                 *    in the defined order, so the full drawn route is always
                 *    stop[0]→stop[1]→...→stop[n], never reversed or doubled back.
                 */
                <MapContainer
                  key="driver-map-stable"
                  center={defaultCenter}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer url={getTileLayerUrl()} attribution={getTileLayerAttribution()} />

                  {/* Fit all stops into view once */}
                  <FitBounds stops={stops} />

                  {/* Pan to bus only when trip is active */}
                  <FollowBus center={busCenter} active={isSharing} />

                  {/* Dashed placeholder lines while road segments are loading */}
                  {routeLoading && stops.map((stop, i) => {
                    if (i === stops.length - 1) return null;
                    const next = stops[i + 1];
                    return (
                      <Polyline
                        key={`placeholder-${i}`}
                        positions={[
                          [stop.location.latitude,  stop.location.longitude],
                          [next.location.latitude,  next.location.longitude]
                        ]}
                        pathOptions={{ color: '#93C5FD', weight: 3, opacity: 0.5, dashArray: '6 8' }}
                      />
                    );
                  })}

                  {/* Real road segments — drawn progressively as each one loads */}
                  {routeSegments.map((coords, i) => (
                    <Polyline
                      key={`segment-${i}`}
                      positions={coords}
                      pathOptions={{
                        color: '#2563EB',
                        weight: 5,
                        opacity: 0.85,
                        lineJoin: 'round',
                        lineCap: 'round'
                      }}
                    />
                  ))}

                  {/* Stop markers */}
                  {stops.map((stop, index) => renderStopMarker(stop, index))}

                  {/* Bus marker — only when GPS is active */}
                  {busCenter && (
                    <Marker position={busCenter} icon={busIcon}>
                      <Popup>
                        <strong>{bus.busName}</strong><br />
                        Speed: {speed} km/h<br />
                        Status: {isSharing ? 'Live Broadcasting' : 'Offline'}
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              ) : (
                <div className="h-full bg-gray-100 flex flex-col items-center justify-center gap-3">
                  <MapPin size={48} className="text-gray-300" />
                  <p className="text-gray-500 font-semibold">No route stops configured</p>
                  <p className="text-sm text-gray-400">Contact admin to set up route stops</p>
                </div>
              )}
            </div>

            {/* Live stats — only when GPS is active */}
            {location && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Latitude</p>
                  <p className="font-mono font-semibold text-sm">{location.latitude.toFixed(6)}</p>
                </div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Longitude</p>
                  <p className="font-mono font-semibold text-sm">{location.longitude.toFixed(6)}</p>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Speed</p>
                  <p className="font-semibold text-green-700">{speed} km/h</p>
                </div>
                <div className="bg-purple-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-600">Status</p>
                  <p className="font-semibold text-purple-700">{isSharing ? 'Broadcasting' : 'Offline'}</p>
                </div>
              </div>
            )}

            {/* Map legend */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-semibold text-gray-700 mb-2">Map Legend:</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-7 h-1 bg-blue-600 rounded"></div>
                  <span>Road Route {totalRouteDistance ? `(${totalRouteDistance} km)` : ''}</span>
                </div>
                {busCenter && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow"></div>
                    <span>Your Bus</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow"></div>
                  <span>Start Stop</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow"></div>
                  <span>End Stop</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 bg-green-500 rounded-full border border-white"></div>
                  <span>Stops</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── CONTROLS PANEL ── */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold mb-4">Trip Controls</h2>

              {!trip ? (
                <button
                  onClick={startTrip}
                  className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 transition text-lg"
                >
                  <Play size={22} />
                  Start Trip
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-blue-800">Trip Active</span>
                      <span className="text-sm text-gray-600">
                        Started {new Date(trip.startTime).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">Route: {trip.route?.routeName}</p>
                    {isSharing && (
                      <div className="mt-2 flex items-center gap-2 text-green-600 text-sm font-semibold">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Broadcasting to passengers
                      </div>
                    )}
                  </div>
                  <button
                    onClick={endTrip}
                    className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-4 px-6 rounded-lg flex items-center justify-center gap-2 transition text-lg"
                  >
                    <Square size={22} />
                    End Trip
                  </button>
                </div>
              )}
            </div>

            {stops.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-semibold mb-1">Route Stops ({stops.length})</h2>
                {stops.length >= 2 && (
                  <p className="text-sm text-gray-500 mb-4">
                    {stops[0].stopName} → {stops[stops.length - 1].stopName}
                  </p>
                )}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {stops.map((stop, index) => {
                    const isFirst = index === 0;
                    const isLast  = index === stops.length - 1;
                    return (
                      <div
                        key={stop._id}
                        className={`flex items-center p-3 rounded-lg transition ${
                          isFirst ? 'bg-blue-50 border border-blue-200'
                          : isLast ? 'bg-red-50 border border-red-200'
                          : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <div className={`text-white rounded-full w-8 h-8 flex items-center justify-center font-semibold mr-3 text-sm shrink-0 ${
                          isFirst ? 'bg-blue-500' : isLast ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{stop.stopName}</p>
                          <p className="text-xs text-gray-600">{stop.stopCode}</p>
                        </div>
                        {isFirst && (
                          <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-full shrink-0">Start</span>
                        )}
                        {isLast && (
                          <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-1 rounded-full shrink-0">End</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default DriverPage;