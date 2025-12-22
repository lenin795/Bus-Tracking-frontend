import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode, MapPin, Clock, X, Scan, Bus as BusIcon, Navigation2 } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Html5QrcodeScanner } from 'html5-qrcode';
import io from 'socket.io-client';
import axios from 'axios';
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

const PassengerPage = () => {
  const [searchParams] = useSearchParams();
  const [showScanner, setShowScanner] = useState(false);
  const [busStop, setBusStop] = useState(null);
  const [nearestBuses, setNearestBuses] = useState([]);
  const [selectedBus, setSelectedBus] = useState(null);
  const [busLocation, setBusLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const socketRef = useRef(null);
  const scannerRef = useRef(null);

  useEffect(() => {
    socketRef.current = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000');

    socketRef.current.on('bus:location-update', (data) => {
      if (selectedBus && data.busId === selectedBus._id) {
        setBusLocation({
          latitude: data.location.latitude,
          longitude: data.location.longitude,
          speed: data.speed,
          timestamp: data.timestamp
        });
        
        // Update bus in nearestBuses array
        setNearestBuses(prev => prev.map(bus => 
          bus._id === data.busId 
            ? {...bus, currentLocation: data.location}
            : bus
        ));
      }
    });

    socketRef.current.on('bus:offline', (data) => {
      if (selectedBus && data.busId === selectedBus._id) {
        setError('Bus has gone offline');
      }
    });

    // Check if stop code in URL
    const stopCode = searchParams.get('stop');
    if (stopCode) {
      fetchNearestBuses(stopCode);
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, [selectedBus, searchParams]);

  const startScanner = () => {
    setShowScanner(true);
    setError('');
    
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        'qr-reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );
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
  };

  const onScanSuccess = async (decodedText) => {
    try {
      stopScanner();
      // Check if it's a URL with stop parameter
      const url = new URL(decodedText);
      const stopCode = url.searchParams.get('stop');
      if (stopCode) {
        await fetchNearestBuses(stopCode);
      }
    } catch (err) {
      setError('Invalid QR code. Please scan a valid bus stop QR code.');
    }
  };

  const onScanError = (err) => {
    // Ignore continuous scan errors
  };

  const fetchNearestBuses = async (stopCode) => {
    setLoading(true);
    setError('');
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      const response = await axios.get(`${API_URL}/passenger/nearest-buses/${stopCode}`);
      setBusStop(response.data.busStop);
      setNearestBuses(response.data.buses);
      
      if (response.data.buses.length === 0) {
        setError('No active buses found on this route');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch buses');
    } finally {
      setLoading(false);
    }
  };

  const trackBus = (bus) => {
    setSelectedBus(bus);
    setBusLocation({
      latitude: bus.currentLocation.latitude,
      longitude: bus.currentLocation.longitude
    });
    socketRef.current.emit('passenger:track-bus', { busId: bus._id });
  };

  const stopTracking = () => {
    if (selectedBus) {
      socketRef.current.emit('passenger:untrack-bus', { busId: selectedBus._id });
    }
    setSelectedBus(null);
    setBusLocation(null);
  };

  const resetView = () => {
    setBusStop(null);
    setNearestBuses([]);
    setSelectedBus(null);
    setBusLocation(null);
    setError('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <div className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <BusIcon className="text-white" size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Bus Tracker</h1>
                <p className="text-sm text-gray-600">Track your bus in real-time</p>
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
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-r-lg">
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        )}

        {/* Initial Scan Button */}
        {!busStop && !showScanner && !selectedBus && (
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

        {/* QR Scanner */}
        {showScanner && (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Scan QR Code</h2>
              <button onClick={stopScanner} className="text-gray-600 hover:text-gray-800 p-2 hover:bg-gray-100 rounded-full transition">
                <X size={28} />
              </button>
            </div>
            <div id="qr-reader" className="w-full"></div>
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-center text-blue-800 font-semibold">
                📱 Position the QR code within the camera frame
              </p>
            </div>
          </div>
        )}

        {/* Map and Bus List */}
        {busStop && !selectedBus && nearestBuses.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Map */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Live Bus Locations</h3>
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                <MapContainer
                  center={[busStop.location.latitude, busStop.location.longitude]}
                  zoom={14}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  
                  {/* Bus Stop Marker */}
                  <Marker
                    position={[busStop.location.latitude, busStop.location.longitude]}
                    icon={stopIcon}
                  >
                    <Popup>
                      <strong>{busStop.stopName}</strong><br />
                      Your Location
                    </Popup>
                  </Marker>
                  
                  {/* Bus Markers */}
                  {nearestBuses.map(bus => (
                    <Marker
                      key={bus._id}
                      position={[bus.currentLocation.latitude, bus.currentLocation.longitude]}
                      icon={busIcon}
                    >
                      <Popup>
                        <strong>{bus.busName}</strong><br />
                        {bus.busNumber}<br />
                        {bus.distanceFromStop} km away<br />
                        ETA: ~{bus.estimatedArrival} min
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            </div>

            {/* Bus List */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                Nearby Buses ({nearestBuses.length})
              </h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {nearestBuses.map((bus) => (
                  <div
                    key={bus._id}
                    className="border-2 border-gray-200 rounded-xl p-4 hover:border-blue-500 hover:shadow-md transition cursor-pointer"
                    onClick={() => trackBus(bus)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="font-bold text-lg">{bus.busName}</h4>
                        <p className="text-sm text-gray-600">{bus.busNumber}</p>
                      </div>
                      <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold">
                        {bus.distanceFromStop} km
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center gap-1 text-gray-700">
                        <Clock size={16} />
                        <span className="text-sm font-semibold">~{bus.estimatedArrival} min</span>
                      </div>
                      <button className="text-blue-600 hover:text-blue-800 font-bold text-sm">
                        Track →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Selected Bus Tracking */}
        {selectedBus && busLocation && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Map with Route */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">Tracking {selectedBus.busName}</h3>
                <button onClick={stopTracking} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm">
                  Stop Tracking
                </button>
              </div>
              <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-200">
                <MapContainer
                  center={[busLocation.latitude, busLocation.longitude]}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  
                  {/* Your Stop */}
                  <Marker position={[busStop.location.latitude, busStop.location.longitude]} icon={stopIcon}>
                    <Popup><strong>Your Stop</strong><br/>{busStop.stopName}</Popup>
                  </Marker>
                  
                  {/* Bus */}
                  <Marker position={[busLocation.latitude, busLocation.longitude]} icon={busIcon}>
                    <Popup><strong>{selectedBus.busName}</strong><br/>{selectedBus.busNumber}</Popup>
                  </Marker>
                  
                  {/* Line between bus and stop */}
                  <Polyline
                    positions={[
                      [busLocation.latitude, busLocation.longitude],
                      [busStop.location.latitude, busStop.location.longitude]
                    ]}
                    color="blue"
                    dashArray="10, 10"
                  />
                </MapContainer>
              </div>
              
              {/* Quick Stats */}
              <div className="grid grid-cols-3 gap-4 mt-4">
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">Distance</p>
                  <p className="text-2xl font-bold text-blue-600">{selectedBus.distanceFromStop} km</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">ETA</p>
                  <p className="text-2xl font-bold text-green-600">~{selectedBus.estimatedArrival} min</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-gray-600">Speed</p>
                  <p className="text-2xl font-bold text-purple-600">{busLocation.speed?.toFixed(0) || 0} km/h</p>
                </div>
              </div>
            </div>

            {/* Route Stops */}
            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Route Stops</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {selectedBus.route?.stops.map((stop, index) => (
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
                <p className="text-center text-green-800 font-bold">
                  🟢 Live tracking active
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PassengerPage;