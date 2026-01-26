import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode, MapPin, Clock, X, Scan, Bus as BusIcon, Navigation2, Map as MapIconLucide, Satellite, Route as RouteIcon } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Html5QrcodeScanner } from 'html5-qrcode';
import io from 'socket.io-client';
import api from '../services/api';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom bus icon
const busIcon = new L.divIcon({
  html: '<div style="background: #3B82F6; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-center;"><span style="color: white; font-size: 20px;">🚌</span></div>',
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const stopIcon = new L.divIcon({
  html: '<div style="background: #EF4444; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-center;"><span style="color: white; font-size: 16px;">📍</span></div>',
  className: '',
  iconSize: [25, 25],
  iconAnchor: [12, 12]
});

const routeStopIcon = new L.divIcon({
  html: '<div style="background: #10B981; border: 2px solid white; border-radius: 50%; width: 16px; height: 16px;"></div>',
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// Component to update map view dynamically
function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

const PassengerPage = () => {
  const [searchParams] = useSearchParams();
  const [showScanner, setShowScanner] = useState(false);
  const [busStop, setBusStop] = useState(null);
  const [nearestBuses, setNearestBuses] = useState([]);
  const [selectedBus, setSelectedBus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanError, setScanError] = useState('');
  const [manualStopCode, setManualStopCode] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapType, setMapType] = useState('street');
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [busToStopRoute, setBusToStopRoute] = useState([]);
  const [routeDistance, setRouteDistance] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  
  const socketRef = useRef(null);
  const scannerRef = useRef(null);

  useEffect(() => {
    const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socketRef.current.on('connect', () => {
      console.log('✅ Socket connected:', socketRef.current.id);
      nearestBuses.forEach(bus => {
        socketRef.current.emit('passenger:track-bus', { busId: bus._id });
      });
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error.message);
    });

    socketRef.current.on('bus:location-update', (data) => {
      console.log('📍 Bus location update:', data);
      
      setNearestBuses(prev => prev.map(bus => {
        if (bus._id === data.busId) {
          const updatedBus = {
            ...bus,
            currentLocation: {
              latitude: data.location.latitude,
              longitude: data.location.longitude
            },
            speed: data.speed,
            lastUpdate: new Date()
          };
          
          if (selectedBus && selectedBus._id === data.busId && busStop) {
            setMapCenter([data.location.latitude, data.location.longitude]);
            fetchRoadRoute(
              data.location.latitude,
              data.location.longitude,
              busStop.location.latitude,
              busStop.location.longitude
            );
          }
          
          return updatedBus;
        }
        return bus;
      }));
    });

    socketRef.current.on('bus:offline', (data) => {
      console.log('🔴 Bus offline:', data.busId);
      setNearestBuses(prev => prev.filter(bus => bus._id !== data.busId));
      if (selectedBus && selectedBus._id === data.busId) {
        setError('Selected bus has gone offline');
        setSelectedBus(null);
      }
    });

    const stopCode = searchParams.get('stop');
    if (stopCode) {
      fetchNearestBuses(stopCode);
    }

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (scannerRef.current) scannerRef.current.clear().catch(console.error);
    };
  }, []);

  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && nearestBuses.length > 0) {
      nearestBuses.forEach(bus => {
        socketRef.current.emit('passenger:track-bus', { busId: bus._id });
      });
    }
  }, [nearestBuses]);

  useEffect(() => {
    if (selectedBus?.currentLocation && busStop) {
      fetchRoadRoute(
        selectedBus.currentLocation.latitude,
        selectedBus.currentLocation.longitude,
        busStop.location.latitude,
        busStop.location.longitude
      );
      
      if (selectedBus.route?.stops) {
        fetchCompleteRouteWithRoads(selectedBus.route.stops);
      }
    }
  }, [selectedBus, busStop]);

  const fetchRoadRoute = async (startLat, startLon, endLat, endLon) => {
    setLoadingRoute(true);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        setBusToStopRoute(coordinates);
        setRouteDistance((route.distance / 1000).toFixed(2));
        console.log('✅ Road route fetched:', coordinates.length, 'points');
      } else {
        setBusToStopRoute([[startLat, startLon], [endLat, endLon]]);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      setBusToStopRoute([[startLat, startLon], [endLat, endLon]]);
    } finally {
      setLoadingRoute(false);
    }
  };

  const fetchCompleteRouteWithRoads = async (stops) => {
    try {
      if (stops.length < 2) return;
      
      const coordinates = stops.map(stop => 
        `${stop.location.longitude},${stop.location.latitude}`
      ).join(';');
      
      const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
        setRouteCoordinates(coords);
        console.log('✅ Complete route fetched:', coords.length, 'points');
      } else {
        const coords = stops.map(stop => [stop.location.latitude, stop.location.longitude]);
        setRouteCoordinates(coords);
      }
    } catch (error) {
      console.error('Error fetching complete route:', error);
      const coords = stops.map(stop => [stop.location.latitude, stop.location.longitude]);
      setRouteCoordinates(coords);
    }
  };

  const startScanner = () => {
    setShowScanner(true);
    setError('');
    setScanError('');
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner('qr-reader', { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true,
        rememberLastUsedCamera: true,
        supportedScanTypes: [0, 1], // QR_CODE and other formats
        videoConstraints: {
          facingMode: { ideal: "environment" } // Use back camera by default
        },
        formatsToSupport: [0] // Only QR codes
      }, false);
      scanner.render(onScanSuccess, onScanError);
      scannerRef.current = scanner;
    }, 100);
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(console.error);
      scannerRef.current = null;
    }
    setShowScanner(false);
    setScanError('');
  };

  const onScanSuccess = async (decodedText) => {
    try {
      stopScanner();
      const url = new URL(decodedText);
      const stopCode = url.searchParams.get('stop');
      if (stopCode) await fetchNearestBuses(stopCode);
    } catch (err) {
      // If URL parsing fails, treat it as a direct stop code
      if (decodedText && decodedText.length > 0) {
        await fetchNearestBuses(decodedText);
      } else {
        setScanError('Invalid QR code. Please scan a valid bus stop QR code.');
        setShowScanner(true);
      }
    }
  };

  const onScanError = (errorMessage) => {
    // Only log severe errors, ignore routine scan failures
    if (errorMessage && !errorMessage.includes('NotFoundException')) {
      console.log('Scan error:', errorMessage);
    }
  };

  const fetchNearestBuses = async (stopCode) => {
    setLoading(true);
    setError('');
    setScanError('');
    try {
      const response = await api.get(`/passenger/nearest-buses/${stopCode}`);
      setBusStop(response.data.busStop);
      
      const buses = response.data.buses || [];
      setNearestBuses(buses);
      
      if (response.data.busStop) {
        setMapCenter([response.data.busStop.location.latitude, response.data.busStop.location.longitude]);
      }
      
      if (buses.length === 0) {
        setError('No active buses found on this route. Waiting for buses to start...');
      }
      
      setShowManualEntry(false);
      setManualStopCode('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch buses. Please check the stop code.');
      setScanError('Stop not found. Please try again or enter the stop code manually.');
    } finally {
      setLoading(false);
    }
  };

  const handleManualEntry = (e) => {
    e.preventDefault();
    if (manualStopCode.trim()) {
      fetchNearestBuses(manualStopCode.trim());
      setShowScanner(false);
      setShowManualEntry(false);
    }
  };

  const trackBus = (bus) => {
    setSelectedBus(bus);
    if (bus.currentLocation) {
      setMapCenter([bus.currentLocation.latitude, bus.currentLocation.longitude]);
    }
  };

  const stopTracking = () => {
    setSelectedBus(null);
    setRouteCoordinates([]);
    setBusToStopRoute([]);
    setRouteDistance(null);
    if (busStop) {
      setMapCenter([busStop.location.latitude, busStop.location.longitude]);
    }
  };

  const resetView = () => {
    if (socketRef.current) {
      nearestBuses.forEach(bus => {
        socketRef.current.emit('passenger:untrack-bus', { busId: bus._id });
      });
    }
    setBusStop(null);
    setNearestBuses([]);
    setSelectedBus(null);
    setMapCenter(null);
    setRouteCoordinates([]);
    setBusToStopRoute([]);
    setError('');
  };

  const toggleMapType = () => {
    setMapType(prev => prev === 'street' ? 'satellite' : 'street');
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(2);
  };

  const calculateETA = (bus) => {
    if (!bus.currentLocation || !busStop) return 'Calculating...';
    
    const distance = routeDistance ? parseFloat(routeDistance) : parseFloat(calculateDistance(
      bus.currentLocation.latitude,
      bus.currentLocation.longitude,
      busStop.location.latitude,
      busStop.location.longitude
    ));

    const speed = bus.speed || 30;
    if (speed < 5) return 'Bus stopped';
    
    const timeInMinutes = Math.round((distance / speed) * 60);

    if (timeInMinutes < 1) return 'Arriving now!';
    if (timeInMinutes === 1) return '1 min';
    return `${timeInMinutes} min`;
  };

  const getTileLayerUrl = () => {
    return mapType === 'satellite' 
      ? 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  };

  const getTileLayerAttribution = () => {
    return mapType === 'satellite'
      ? '&copy; <a href="https://www.google.com/maps">Google Maps</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <BusIcon className="text-white" size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Bus Tracker</h1>
                <p className="text-sm text-gray-600">Track your bus in real-time with road routing</p>
              </div>
            </div>
            {(busStop || selectedBus) && (
              <button onClick={resetView} className="text-blue-600 hover:text-blue-800 font-semibold text-sm">
                ← Scan New Stop
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && nearestBuses.length === 0 && busStop && (
          <div className="bg-yellow-50 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded-r-lg">
            <p className="font-semibold">Note</p>
            <p>{error}</p>
            <p className="text-sm mt-2">The map below shows your bus stop location. Buses will appear here once they start their trips.</p>
          </div>
        )}

        {error && !busStop && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-r-lg">
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 font-semibold">Loading bus information...</p>
          </div>
        )}

        {!busStop && !showScanner && !selectedBus && !loading && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full mb-6 shadow-lg">
              <QrCode className="text-white" size={48} />
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-3">Find Your Bus</h2>
            <p className="text-gray-600 mb-8 text-lg">
              Scan the QR code at your bus stop to see incoming buses
            </p>
            <button onClick={startScanner} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-10 py-4 rounded-xl inline-flex items-center gap-3 shadow-lg transform transition hover:scale-105">
              <Scan size={24} />
              Scan QR Code
            </button>
          </div>
        )}

        {showScanner && (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Scan QR Code</h2>
              <button onClick={stopScanner} className="text-gray-600 hover:text-gray-800 p-2 hover:bg-gray-100 rounded-full transition">
                <X size={28} />
              </button>
            </div>
            
            {scanError && (
              <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-4 rounded-r-lg">
                <p className="font-semibold">Scan Error</p>
                <p>{scanError}</p>
              </div>
            )}
            
            <div id="qr-reader" className="w-full"></div>
            
            <div className="mt-6 space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-center text-blue-800 font-semibold mb-2">
                  📱 Position the QR code within the camera frame
                </p>
                <p className="text-center text-sm text-blue-600">
                  Make sure to allow camera permissions when prompted
                </p>
              </div>
              
              <div className="text-center">
                <button 
                  onClick={() => setShowManualEntry(!showManualEntry)} 
                  className="text-blue-600 hover:text-blue-800 font-semibold text-sm underline"
                >
                  {showManualEntry ? 'Hide' : 'Can\'t scan? Enter stop code manually'}
                </button>
              </div>
              
              {showManualEntry && (
                <form onSubmit={handleManualEntry} className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Enter Bus Stop Code
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualStopCode}
                      onChange={(e) => setManualStopCode(e.target.value)}
                      placeholder="e.g., CS001"
                      className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                    <button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition"
                    >
                      Find
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    💡 You can find the stop code printed on the QR code poster at your bus stop
                  </p>
                </form>
              )}
            </div>
          </div>
        )}

        {busStop && !selectedBus && !loading && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">
                  {nearestBuses.length > 0 ? 'Live Bus Locations' : 'Your Bus Stop Location'}
                </h3>
                <div className="flex items-center gap-2">
                  <button onClick={toggleMapType} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition">
                    {mapType === 'street' ? <><Satellite size={18} /><span className="text-sm font-semibold">Satellite</span></> : <><MapIconLucide size={18} /><span className="text-sm font-semibold">Street</span></>}
                  </button>
                  {nearestBuses.length > 0 && (
                    <span className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                      </span>
                      Live
                    </span>
                  )}
                </div>
              </div>
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                {mapCenter && (
                  <MapContainer center={mapCenter} zoom={15} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url={getTileLayerUrl()} attribution={getTileLayerAttribution()} />
                    <MapUpdater center={mapCenter} />
                    <Marker position={[busStop.location.latitude, busStop.location.longitude]} icon={stopIcon}>
                      <Popup>
                        <strong>{busStop.stopName}</strong><br />
                        Code: {busStop.stopCode}<br />
                        📍 Your Location
                      </Popup>
                    </Marker>
                    {nearestBuses.map(bus => bus.currentLocation && (
                      <Marker key={bus._id} position={[bus.currentLocation.latitude, bus.currentLocation.longitude]} icon={busIcon}>
                        <Popup>
                          <strong>{bus.busName}</strong><br />
                          {bus.busNumber}<br />
                          Speed: {bus.speed ? `${bus.speed.toFixed(0)} km/h` : 'N/A'}
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                )}
              </div>
              
              {nearestBuses.length === 0 && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-center text-blue-800 font-semibold flex items-center justify-center gap-2">
                    <MapPin size={20} />
                    Waiting for buses to start on this route...
                  </p>
                  <p className="text-center text-sm text-blue-600 mt-2">
                    The map shows your bus stop location. Active buses will appear here automatically.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                Bus Stop Information
              </h3>
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl mb-4">
                <h4 className="font-bold text-lg text-gray-800">{busStop.stopName}</h4>
                <p className="text-sm text-gray-600">Code: {busStop.stopCode}</p>
                {busStop.address && (
                  <p className="text-xs text-gray-500 mt-2">📍 {busStop.address}</p>
                )}
              </div>

              {nearestBuses.length > 0 ? (
                <>
                  <h4 className="font-semibold text-gray-700 mb-3">
                    Nearby Buses ({nearestBuses.length})
                  </h4>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {nearestBuses.map((bus) => {
                      const distance = bus.currentLocation && busStop ? calculateDistance(
                        bus.currentLocation.latitude,
                        bus.currentLocation.longitude,
                        busStop.location.latitude,
                        busStop.location.longitude
                      ) : 'N/A';
                      
                      return (
                        <div key={bus._id} className="border-2 border-gray-200 rounded-xl p-4 hover:border-blue-500 hover:shadow-md transition cursor-pointer" onClick={() => trackBus(bus)}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h4 className="font-bold text-lg">{bus.busName}</h4>
                              <p className="text-sm text-gray-600">{bus.busNumber}</p>
                            </div>
                            <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold">
                              ~{distance} km
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 border-t">
                            <div className="flex items-center gap-1 text-gray-700">
                              <Clock size={16} />
                              <span className="text-sm font-semibold">{calculateETA(bus)}</span>
                            </div>
                            <button className="text-blue-600 hover:text-blue-800 font-bold text-sm">
                              Track →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <BusIcon className="mx-auto text-gray-300 mb-4" size={64} />
                  <h4 className="font-semibold text-gray-700 mb-2">No Active Buses</h4>
                  <p className="text-sm text-gray-500">
                    Buses will appear here once drivers start their trips on this route.
                  </p>
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600">
                      💡 This page will automatically update when buses become active
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedBus && selectedBus.currentLocation && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Tracking {selectedBus.busName}</h3>
                  {loadingRoute && <p className="text-sm text-gray-500">Calculating road route...</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={toggleMapType} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition">
                    {mapType === 'street' ? <><Satellite size={18} /><span className="text-sm font-semibold">Satellite</span></> : <><MapIconLucide size={18} /><span className="text-sm font-semibold">Street</span></>}
                  </button>
                  <button onClick={stopTracking} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                    Stop Tracking
                  </button>
                </div>
              </div>
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                {mapCenter && (
                  <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url={getTileLayerUrl()} attribution={getTileLayerAttribution()} />
                    <MapUpdater center={mapCenter} />
                    
                    {routeCoordinates.length > 0 && (
                      <Polyline positions={routeCoordinates} color="#3B82F6" weight={5} opacity={0.6} />
                    )}
                    
                    {busToStopRoute.length > 0 && (
                      <Polyline positions={busToStopRoute} color="#10B981" weight={6} opacity={0.9} />
                    )}
                    
                    {selectedBus.route?.stops?.map((stop) => (
                      <Marker key={stop._id} position={[stop.location.latitude, stop.location.longitude]} icon={stop._id === busStop._id ? stopIcon : routeStopIcon}>
                        <Popup>
                          <strong>{stop.stopName}</strong><br />
                          {stop.stopCode}
                          {stop._id === busStop._id && <><br /><span className="text-blue-600 font-semibold">📍 You are here</span></>}
                        </Popup>
                      </Marker>
                    ))}
                    
                    <Marker position={[selectedBus.currentLocation.latitude, selectedBus.currentLocation.longitude]} icon={busIcon}>
                      <Popup>
                        <strong>{selectedBus.busName}</strong><br/>
                        {selectedBus.busNumber}<br/>
                        Speed: {selectedBus.speed?.toFixed(0) || 0} km/h
                      </Popup>
                    </Marker>
                  </MapContainer>
                )}
              </div>
              
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600 flex items-center justify-center gap-1">
                    <RouteIcon size={14} />
                    Road Distance
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {routeDistance || calculateDistance(
                      selectedBus.currentLocation.latitude,
                      selectedBus.currentLocation.longitude,
                      busStop.location.latitude,
                      busStop.location.longitude
                    )} km
                  </p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">ETA</p>
                  <p className="text-2xl font-bold text-green-600">{calculateETA(selectedBus)}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">Speed</p>
                  <p className="text-2xl font-bold text-purple-600">{selectedBus.speed?.toFixed(0) || 0} km/h</p>
                </div>
              </div>
              
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs font-semibold text-gray-700 mb-2">Map Legend:</p>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-1 bg-blue-500"></div>
                    <span>Complete Route</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-1 bg-green-500"></div>
                    <span>Road to Your Stop</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                    <span>Bus</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                    <span>Your Stop</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span>Route Stops</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Route Stops</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {selectedBus.route?.stops?.map((stop, index) => (
                  <div 
                    key={stop._id} 
                    className={`flex items-center p-3 rounded-xl ${
                      stop._id === busStop._id 
                        ? 'bg-blue-50 border-2 border-blue-500' 
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className={`rounded-full w-10 h-10 flex items-center justify-center font-bold mr-3 ${
                      stop._id === busStop._id ? 'bg-blue-600 text-white' : 'bg-gray-300'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold">{stop.stopName}</p>
                      <p className="text-xs text-gray-600">{stop.stopCode}</p>
                    </div>
                    {stop._id === busStop._id && (
                      <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        You
                      </span>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="mt-4 p-4 bg-green-50 border-2 border-green-200 rounded-xl">
                <p className="text-center text-green-800 font-bold flex items-center justify-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  Live tracking active
                </p>
                {routeDistance && (
                  <p className="text-center text-sm text-green-700 mt-2">
                    Following road route: {routeDistance} km
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PassengerPage;