import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QrCode, MapPin, Clock, X, Scan, Bus as BusIcon, Navigation2, Map as MapIconLucide, Satellite, Route as RouteIcon, Bell, CheckCircle, AlertTriangle, ArrowRight, ArrowLeft } from 'lucide-react';
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
  html: '<div style="background: #3B82F6; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;"><span style="color: white; font-size: 20px;">🚌</span></div>',
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const stopIcon = new L.divIcon({
  html: '<div style="background: #EF4444; border-radius: 50%; width: 25px; height: 25px; display: flex; align-items: center; justify-content: center;"><span style="color: white; font-size: 16px;">📍</span></div>',
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

const nextStopIcon = new L.divIcon({
  html: '<div style="background: #F59E0B; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; box-shadow: 0 2px 8px rgba(245,158,11,0.5);"></div>',
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

// ✅ Passed stop icon (gray)
const passedStopIcon = new L.divIcon({
  html: '<div style="background: #9CA3AF; border: 2px solid white; border-radius: 50%; width: 14px; height: 14px; opacity: 0.6;"></div>',
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

function MapUpdater({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.panTo(center, { animate: true, duration: 0.5 });
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
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  
  // Next stop and status tracking
  const [nextStop, setNextStop] = useState(null);
  const [busStatus, setBusStatus] = useState(null);
  const [notification, setNotification] = useState(null);
  
  // ✅ NEW: Direction tracking
  const [busDirection, setBusDirection] = useState(null); // 'forward' or 'reverse'
  const [directionStops, setDirectionStops] = useState([]); // Ordered stops based on direction
  const [destinationStop, setDestinationStop] = useState(null); // Where bus is heading
  
  // ✅ NEW: Distance filtering
  const [maxDistanceKm, setMaxDistanceKm] = useState(10); // Default 10km radius
  const [totalBusesCount, setTotalBusesCount] = useState(0); // Total buses on route (before filter)
  
  const socketRef = useRef(null);
  const scannerRef = useRef(null);

  const selectedBusRef = useRef(null);
  const busStopRef = useRef(null);
  const nearestBusesRef = useRef([]);
  const previousLocationRef = useRef(null); // Track previous position for direction calculation

  useEffect(() => { selectedBusRef.current = selectedBus; }, [selectedBus]);
  useEffect(() => { busStopRef.current = busStop; }, [busStop]);
  useEffect(() => { nearestBusesRef.current = nearestBuses; }, [nearestBuses]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
  }, []);

  // ✅ Calculate distance between two points
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // ✅ FIXED: Detect bus direction based on movement and user's stop position
  const detectBusDirection = useCallback((currentLocation, previousLocation, routeStops, userStop) => {
    if (!currentLocation || !previousLocation || !routeStops || routeStops.length < 2) {
      return null;
    }

    const firstStop = routeStops[0];
    const lastStop = routeStops[routeStops.length - 1];

    // Calculate distances from previous and current positions to first and last stops
    const prevDistToFirst = calculateDistance(
      previousLocation.latitude,
      previousLocation.longitude,
      firstStop.location.latitude,
      firstStop.location.longitude
    );

    const currDistToFirst = calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      firstStop.location.latitude,
      firstStop.location.longitude
    );

    const prevDistToLast = calculateDistance(
      previousLocation.latitude,
      previousLocation.longitude,
      lastStop.location.latitude,
      lastStop.location.longitude
    );

    const currDistToLast = calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      lastStop.location.latitude,
      lastStop.location.longitude
    );

    // Primary detection: movement toward first or last stop
    const movingTowardLast = currDistToLast < prevDistToLast;
    const movingAwayFromFirst = currDistToFirst > prevDistToFirst;
    const movingTowardFirst = currDistToFirst < prevDistToFirst;
    const movingAwayFromLast = currDistToLast > prevDistToLast;

    if (movingTowardLast && movingAwayFromFirst) {
      return 'forward'; // Going from first stop to last stop (e.g., Salem → Attur)
    } else if (movingTowardFirst && movingAwayFromLast) {
      return 'reverse'; // Going from last stop to first stop (e.g., Attur → Salem)
    }

    // ✅ NEW: If user is at a middle stop, use it to determine direction
    if (userStop) {
      const userStopIndex = routeStops.findIndex(s => s._id === userStop._id);
      
      if (userStopIndex > 0 && userStopIndex < routeStops.length - 1) {
        // User is at a middle stop, calculate distance to user's stop
        const currDistToUserStop = calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          userStop.location.latitude,
          userStop.location.longitude
        );

        const prevDistToUserStop = calculateDistance(
          previousLocation.latitude,
          previousLocation.longitude,
          userStop.location.latitude,
          userStop.location.longitude
        );

        // ✅ Check if bus is moving toward or away from user's stop
        const movingTowardUserStop = currDistToUserStop < prevDistToUserStop;
        const movingAwayFromUserStop = currDistToUserStop > prevDistToUserStop;

        // If moving toward user's middle stop
        if (movingTowardUserStop) {
          // Check which direction the bus came from
          if (currDistToFirst < currDistToLast) {
            // Bus is closer to first stop → must be going forward
            return 'forward';
          } else {
            // Bus is closer to last stop → must be going reverse
            return 'reverse';
          }
        }

        // If moving away from user's middle stop
        if (movingAwayFromUserStop) {
          // Bus has passed the middle stop, determine which way it went
          if (currDistToLast < currDistToFirst) {
            // Moving toward last stop → forward
            return 'forward';
          } else {
            // Moving toward first stop → reverse
            return 'reverse';
          }
        }
      }
    }

    // Fallback: check which end is closer
    if (currDistToFirst < currDistToLast) {
      return 'reverse'; // Closer to first stop, likely going back
    } else {
      return 'forward'; // Closer to last stop, likely going forward
    }
  }, []);

  // ✅ Get ordered stops based on direction
  const getDirectedStops = useCallback((stops, direction) => {
    if (!stops || stops.length === 0) return [];
    if (direction === 'reverse') {
      return [...stops].reverse();
    }
    return stops;
  }, []);

  // ✅ Calculate next stop based on direction
  const calculateNextStop = useCallback((bus, userStop, orderedStops) => {
    if (!bus?.currentLocation || !orderedStops?.length) return null;

    // Find closest stop ahead in the directed route
    let closestStopAhead = null;
    let minDistance = Infinity;

    const userStopIndex = orderedStops.findIndex(s => s._id === userStop?._id);

    for (let i = 0; i < orderedStops.length; i++) {
      const stop = orderedStops[i];
      const distance = calculateDistance(
        bus.currentLocation.latitude,
        bus.currentLocation.longitude,
        stop.location.latitude,
        stop.location.longitude
      );

      // Only consider stops that haven't been passed yet
      if (userStopIndex === -1 || i <= userStopIndex) {
        if (distance < minDistance) {
          minDistance = distance;
          closestStopAhead = { ...stop, index: i, distance: distance.toFixed(2) };
        }
      }
    }

    return closestStopAhead;
  }, []);

  // ✅ Determine bus status relative to user's stop
  const determineBusStatus = useCallback((bus, userStop, nextStopData, orderedStops) => {
    if (!bus?.currentLocation || !userStop || !nextStopData || !orderedStops) return 'far';

    const userStopIndex = orderedStops.findIndex(s => s._id === userStop._id);
    if (userStopIndex === -1) return 'far';

    const distanceToUserStop = calculateDistance(
      bus.currentLocation.latitude,
      bus.currentLocation.longitude,
      userStop.location.latitude,
      userStop.location.longitude
    );

    // If the next stop is past the user's stop, bus has passed
    if (nextStopData.index > userStopIndex) {
      return 'passed';
    }

    // If bus is within 1km of user's stop and moving toward it
    if (distanceToUserStop <= 1 && nextStopData.index <= userStopIndex) {
      return 'approaching';
    }

    return 'far';
  }, []);

  const fetchRoadRoute = useCallback(async (startLat, startLon, endLat, endLon) => {
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
      } else {
        setBusToStopRoute([[startLat, startLon], [endLat, endLon]]);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      setBusToStopRoute([[startLat, startLon], [endLat, endLon]]);
    } finally {
      setLoadingRoute(false);
    }
  }, []);

  const fetchCompleteRouteWithRoads = useCallback(async (stops) => {
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
      } else {
        const coords = stops.map(stop => [stop.location.latitude, stop.location.longitude]);
        setRouteCoordinates(coords);
      }
    } catch (error) {
      console.error('Error fetching complete route:', error);
      const coords = stops.map(stop => [stop.location.latitude, stop.location.longitude]);
      setRouteCoordinates(coords);
    }
  }, []);

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
      nearestBusesRef.current.forEach(bus => {
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
      console.log('📍 Bus location update received:', data);
      
      const currentSelectedBus = selectedBusRef.current;
      const currentBusStop = busStopRef.current;

      setNearestBuses(prev => {
        const updated = prev.map(bus => {
          if (bus._id === data.busId) {
            return {
              ...bus,
              currentLocation: {
                latitude: data.location.latitude,
                longitude: data.location.longitude
              },
              speed: data.speed,
              lastUpdate: new Date()
            };
          }
          return bus;
        });

        // ✅ NEW: Filter out buses that moved beyond the radius
        if (currentBusStop) {
          return updated.filter(bus => {
            if (!bus.currentLocation) return true; // Keep buses without location
            
            const distance = calculateDistance(
              bus.currentLocation.latitude,
              bus.currentLocation.longitude,
              currentBusStop.location.latitude,
              currentBusStop.location.longitude
            );
            
            const withinRange = distance <= maxDistanceKm;
            
            if (!withinRange) {
              console.log(`🔴 Bus ${bus.busName} moved beyond ${maxDistanceKm}km (${distance.toFixed(2)}km), removing from list`);
            }
            
            return withinRange;
          });
        }

        return updated;
      });

      if (currentSelectedBus && currentSelectedBus._id === data.busId) {
        const newLat = data.location.latitude;
        const newLng = data.location.longitude;
        const newLocation = { latitude: newLat, longitude: newLng };

        // ✅ Detect direction based on movement
        const previousLoc = previousLocationRef.current;
        if (previousLoc && currentSelectedBus.route?.stops) {
          const detectedDirection = detectBusDirection(
            newLocation,
            previousLoc,
            currentSelectedBus.route.stops,
            currentBusStop // ✅ Pass user's stop for better detection
          );
          
          if (detectedDirection && detectedDirection !== busDirection) {
            console.log('🧭 Direction changed:', detectedDirection);
            setBusDirection(detectedDirection);
            
            // Update ordered stops based on new direction
            const ordered = getDirectedStops(currentSelectedBus.route.stops, detectedDirection);
            setDirectionStops(ordered);
            
            // Set destination (last stop in the directed route)
            setDestinationStop(ordered[ordered.length - 1]);
            
            showNotification(
              `🧭 Bus is heading ${detectedDirection === 'forward' ? 'to' : 'back to'} ${ordered[ordered.length - 1]?.stopName}`,
              'info'
            );
          }
        }

        // Store current location as previous for next update
        previousLocationRef.current = newLocation;

        const updatedBus = {
          ...currentSelectedBus,
          currentLocation: newLocation,
          speed: data.speed,
          lastUpdate: new Date()
        };

        setSelectedBus(updatedBus);
        setMapCenter([newLat, newLng]);
        setLastUpdateTime(new Date());

        if (currentBusStop) {
          // Use directed stops for calculations
          const stopsToUse = directionStops.length > 0 ? directionStops : currentSelectedBus.route?.stops;
          
          const nextStopData = calculateNextStop(updatedBus, currentBusStop, stopsToUse);
          setNextStop(nextStopData);

          const status = determineBusStatus(updatedBus, currentBusStop, nextStopData, stopsToUse);
          
          if (status !== busStatus) {
            setBusStatus(status);
            
            if (status === 'approaching') {
              showNotification(`🚌 ${updatedBus.busName} is approaching your stop!`, 'success');
            } else if (status === 'passed') {
              showNotification(`⚠️ ${updatedBus.busName} has passed your stop`, 'warning');
            }
          }

          fetchRoadRoute(newLat, newLng, currentBusStop.location.latitude, currentBusStop.location.longitude);
        }
      }
    });

    socketRef.current.on('bus:offline', (data) => {
      console.log('🔴 Bus offline:', data.busId);
      setNearestBuses(prev => prev.filter(bus => bus._id !== data.busId));

      if (selectedBusRef.current && selectedBusRef.current._id === data.busId) {
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
  }, [searchParams, fetchRoadRoute, calculateNextStop, determineBusStatus, showNotification, detectBusDirection, getDirectedStops, busDirection, directionStops, maxDistanceKm]);

  useEffect(() => {
    if (socketRef.current?.connected && nearestBuses.length > 0) {
      nearestBuses.forEach(bus => {
        socketRef.current.emit('passenger:track-bus', { busId: bus._id });
      });
    }
  }, [nearestBuses.length]);

  useEffect(() => {
    if (selectedBus?.currentLocation && busStop) {
      fetchRoadRoute(
        selectedBus.currentLocation.latitude,
        selectedBus.currentLocation.longitude,
        busStop.location.latitude,
        busStop.location.longitude
      );
      
      if (selectedBus.route?.stops) {
        // Use directed stops for route visualization
        const stopsForRoute = directionStops.length > 0 ? directionStops : selectedBus.route.stops;
        fetchCompleteRouteWithRoads(stopsForRoute);
      }
    }
  }, [selectedBus?._id, busStop, directionStops]);

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
        supportedScanTypes: [0, 1],
        videoConstraints: { facingMode: { ideal: "environment" } },
        formatsToSupport: [0]
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
    } catch {
      if (decodedText?.length > 0) {
        await fetchNearestBuses(decodedText);
      } else {
        setScanError('Invalid QR code. Please scan a valid bus stop QR code.');
        setShowScanner(true);
      }
    }
  };

  const onScanError = (errorMessage) => {
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
      setTotalBusesCount(buses.length); // Track total before filtering
      
      // ✅ Filter buses within configured radius
      const filteredBuses = buses.filter(bus => {
        if (!bus.currentLocation || !response.data.busStop) return false;
        
        const distance = calculateDistance(
          bus.currentLocation.latitude,
          bus.currentLocation.longitude,
          response.data.busStop.location.latitude,
          response.data.busStop.location.longitude
        );
        
        return distance <= maxDistanceKm;
      });

      console.log(`📍 Found ${buses.length} total buses, ${filteredBuses.length} within ${maxDistanceKm}km`);
      
      setNearestBuses(filteredBuses);

      if (response.data.busStop) {
        setMapCenter([
          response.data.busStop.location.latitude,
          response.data.busStop.location.longitude
        ]);
      }

      if (filteredBuses.length === 0) {
        if (buses.length > 0) {
          setError(`No buses within ${maxDistanceKm}km of your stop. ${buses.length} bus(es) on this route but too far away.`);
        } else {
          setError('No active buses found on this route. Waiting for buses to start...');
        }
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
    setBusToStopRoute([]);
    setRouteCoordinates([]);
    setRouteDistance(null);
    setNextStop(null);
    setBusStatus(null);
    setBusDirection(null);
    setDirectionStops([]);
    setDestinationStop(null);
    previousLocationRef.current = bus.currentLocation || null;
    
    if (bus.currentLocation) {
      setMapCenter([bus.currentLocation.latitude, bus.currentLocation.longitude]);
      
      // ✅ IMPROVED: Better initial direction detection
      if (busStop && bus.route?.stops && bus.currentLocation) {
        const firstStop = bus.route.stops[0];
        const lastStop = bus.route.stops[bus.route.stops.length - 1];
        const userStopIndex = bus.route.stops.findIndex(s => s._id === busStop._id);
        
        const distToFirst = calculateDistance(
          bus.currentLocation.latitude,
          bus.currentLocation.longitude,
          firstStop.location.latitude,
          firstStop.location.longitude
        );
        
        const distToLast = calculateDistance(
          bus.currentLocation.latitude,
          bus.currentLocation.longitude,
          lastStop.location.latitude,
          lastStop.location.longitude
        );

        const distToUserStop = calculateDistance(
          bus.currentLocation.latitude,
          bus.currentLocation.longitude,
          busStop.location.latitude,
          busStop.location.longitude
        );

        let initialDirection;

        // ✅ If user is at first or last stop, simple detection
        if (userStopIndex === 0) {
          // User at first stop → bus must be going forward
          initialDirection = 'forward';
        } else if (userStopIndex === bus.route.stops.length - 1) {
          // User at last stop → bus must be going reverse
          initialDirection = 'reverse';
        } else {
          // ✅ User at middle stop - use smart detection
          
          // Calculate distances to stops before and after user's stop
          const prevStopIndex = Math.max(0, userStopIndex - 1);
          const nextStopIndex = Math.min(bus.route.stops.length - 1, userStopIndex + 1);
          
          const prevStop = bus.route.stops[prevStopIndex];
          const nextStop = bus.route.stops[nextStopIndex];
          
          const distToPrevStop = calculateDistance(
            bus.currentLocation.latitude,
            bus.currentLocation.longitude,
            prevStop.location.latitude,
            prevStop.location.longitude
          );
          
          const distToNextStop = calculateDistance(
            bus.currentLocation.latitude,
            bus.currentLocation.longitude,
            nextStop.location.latitude,
            nextStop.location.longitude
          );

          // If bus is closer to previous stop (before user's stop) → going forward
          // If bus is closer to next stop (after user's stop) → going reverse
          if (distToPrevStop < distToNextStop) {
            initialDirection = 'forward';
            console.log('🧭 Middle stop detection: Bus closer to previous stop → FORWARD');
          } else if (distToNextStop < distToPrevStop) {
            initialDirection = 'reverse';
            console.log('🧭 Middle stop detection: Bus closer to next stop → REVERSE');
          } else {
            // Fallback: use first/last stop distance
            initialDirection = distToFirst < distToLast ? 'reverse' : 'forward';
            console.log('🧭 Middle stop detection: Fallback to first/last comparison →', initialDirection.toUpperCase());
          }
        }
        
        console.log('🧭 Initial direction detected:', initialDirection, `(User at stop ${userStopIndex + 1}/${bus.route.stops.length})`);
        setBusDirection(initialDirection);
        
        const ordered = getDirectedStops(bus.route.stops, initialDirection);
        setDirectionStops(ordered);
        setDestinationStop(ordered[ordered.length - 1]);
        
        const nextStopData = calculateNextStop(bus, busStop, ordered);
        setNextStop(nextStopData);
        const status = determineBusStatus(bus, busStop, nextStopData, ordered);
        setBusStatus(status);
      }
    }
  };

  const stopTracking = () => {
    setSelectedBus(null);
    setRouteCoordinates([]);
    setBusToStopRoute([]);
    setRouteDistance(null);
    setLastUpdateTime(null);
    setNextStop(null);
    setBusStatus(null);
    setBusDirection(null);
    setDirectionStops([]);
    setDestinationStop(null);
    previousLocationRef.current = null;
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
    setRouteDistance(null);
    setLastUpdateTime(null);
    setNextStop(null);
    setBusStatus(null);
    setBusDirection(null);
    setDirectionStops([]);
    setDestinationStop(null);
    previousLocationRef.current = null;
    setError('');
  };

  const toggleMapType = () => {
    setMapType(prev => prev === 'street' ? 'satellite' : 'street');
  };

  const calculateETA = (bus) => {
    if (!bus.currentLocation || !busStop) return 'Calculating...';
    const distance = routeDistance
      ? parseFloat(routeDistance)
      : parseFloat(calculateDistance(
          bus.currentLocation.latitude,
          bus.currentLocation.longitude,
          busStop.location.latitude,
          busStop.location.longitude
        ).toFixed(2));
    const speed = bus.speed || 30;
    if (speed < 5) return 'Bus stopped';
    const timeInMinutes = Math.round((distance / speed) * 60);
    if (timeInMinutes < 1) return 'Arriving now!';
    if (timeInMinutes === 1) return '1 min';
    return `${timeInMinutes} min`;
  };

  const getTileLayerUrl = () =>
    mapType === 'satellite'
      ? 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const getTileLayerAttribution = () =>
    mapType === 'satellite'
      ? '&copy; <a href="https://www.google.com/maps">Google Maps</a>'
      : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  const formatLastUpdate = () => {
    if (!lastUpdateTime) return null;
    const secs = Math.floor((new Date() - lastUpdateTime) / 1000);
    if (secs < 5) return 'Just now';
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  };

  // ✅ Get display stops (ordered by direction)
  const displayStops = directionStops.length > 0 ? directionStops : selectedBus?.route?.stops || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[9999] flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl text-white font-semibold animate-slide-in ${
          notification.type === 'success' ? 'bg-green-600' 
            : notification.type === 'warning' ? 'bg-orange-600' 
            : 'bg-blue-600'
        }`}>
          <Bell className="animate-bounce" size={20} />
          <span>{notification.message}</span>
          <button onClick={() => setNotification(null)} className="ml-2 opacity-75 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bg-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <BusIcon className="text-white" size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Bus Tracker</h1>
                <p className="text-sm text-gray-600">Real-time tracking with bidirectional route detection</p>
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
            <p className="text-gray-600 mb-8 text-lg">Scan the QR code at your bus stop to see incoming buses</p>
            <button
              onClick={startScanner}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-10 py-4 rounded-xl inline-flex items-center gap-3 shadow-lg transform transition hover:scale-105"
            >
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
                <p className="text-center text-blue-800 font-semibold mb-2">📱 Position the QR code within the camera frame</p>
                <p className="text-center text-sm text-blue-600">Make sure to allow camera permissions when prompted</p>
              </div>
              <div className="text-center">
                <button onClick={() => setShowManualEntry(!showManualEntry)} className="text-blue-600 hover:text-blue-800 font-semibold text-sm underline">
                  {showManualEntry ? 'Hide' : "Can't scan? Enter stop code manually"}
                </button>
              </div>
              {showManualEntry && (
                <form onSubmit={handleManualEntry} className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Enter Bus Stop Code</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualStopCode}
                      onChange={(e) => setManualStopCode(e.target.value)}
                      placeholder="e.g., CS001"
                      className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition">
                      Find
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">💡 You can find the stop code printed on the QR code poster at your bus stop</p>
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
                    {mapType === 'street'
                      ? <><Satellite size={18} /><span className="text-sm font-semibold">Satellite</span></>
                      : <><MapIconLucide size={18} /><span className="text-sm font-semibold">Street</span></>}
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
                      <Marker
                        key={bus._id}
                        position={[bus.currentLocation.latitude, bus.currentLocation.longitude]}
                        icon={busIcon}
                      >
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
                  <p className="text-center text-sm text-blue-600 mt-2">Active buses will appear here automatically.</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Bus Stop Information</h3>
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl mb-4">
                <h4 className="font-bold text-lg text-gray-800">{busStop.stopName}</h4>
                <p className="text-sm text-gray-600">Code: {busStop.stopCode}</p>
                {busStop.address && <p className="text-xs text-gray-500 mt-2">📍 {busStop.address}</p>}
              </div>

              {/* ✅ NEW: Distance filter info */}
              <div className="bg-blue-50 border-2 border-blue-200 p-3 rounded-lg mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Navigation2 size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">
                      Showing buses within {maxDistanceKm}km
                    </span>
                  </div>
                  {totalBusesCount > nearestBuses.length && (
                    <span className="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded-full">
                      {totalBusesCount - nearestBuses.length} filtered
                    </span>
                  )}
                </div>
              </div>

              {nearestBuses.length > 0 ? (
                <>
                  <h4 className="font-semibold text-gray-700 mb-3">Nearby Buses ({nearestBuses.length})</h4>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {nearestBuses.map((bus) => {
                      const distance = bus.currentLocation && busStop
                        ? calculateDistance(
                            bus.currentLocation.latitude,
                            bus.currentLocation.longitude,
                            busStop.location.latitude,
                            busStop.location.longitude
                          ).toFixed(2)
                        : 'N/A';

                      return (
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
                  <h4 className="font-semibold text-gray-700 mb-2">
                    {totalBusesCount > 0 ? `No Buses Within ${maxDistanceKm}km` : 'No Active Buses'}
                  </h4>
                  <p className="text-sm text-gray-500">
                    {totalBusesCount > 0 
                      ? `${totalBusesCount} bus(es) on this route but all are more than ${maxDistanceKm}km away.`
                      : 'Buses will appear here once drivers start their trips on this route.'}
                  </p>
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600">
                      {totalBusesCount > 0
                        ? '💡 Buses will appear when they come within range'
                        : '💡 This page will automatically update when buses become active'}
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
                  <div className="flex items-center gap-3 mt-1">
                    {loadingRoute && <p className="text-sm text-gray-500">Calculating road route...</p>}
                    {lastUpdateTime && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        Updated {formatLastUpdate()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={toggleMapType} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition">
                    {mapType === 'street'
                      ? <><Satellite size={18} /><span className="text-sm font-semibold">Satellite</span></>
                      : <><MapIconLucide size={18} /><span className="text-sm font-semibold">Street</span></>}
                  </button>
                  <button onClick={stopTracking} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                    Stop Tracking
                  </button>
                </div>
              </div>

              {/* ✅ Direction Banner */}
              {busDirection && destinationStop && (
                <div className="mb-4 p-4 rounded-xl border-2 bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-300 flex items-center gap-3">
                  {busDirection === 'forward' ? <ArrowRight size={28} className="text-purple-600" /> : <ArrowLeft size={28} className="text-purple-600" />}
                  <div className="flex-1">
                    <p className="font-bold text-purple-900 text-lg">
                      🧭 Heading to {destinationStop.stopName}
                    </p>
                    <p className="text-sm text-purple-700 mt-1">
                      Direction: {busDirection === 'forward' ? 'Forward Route' : 'Return Route'}
                    </p>
                  </div>
                </div>
              )}

              {/* Bus Status Banner */}
              {busStatus && (
                <div className={`mb-4 p-4 rounded-xl border-2 flex items-center gap-3 ${
                  busStatus === 'approaching'
                    ? 'bg-green-50 border-green-300 text-green-800'
                    : busStatus === 'passed'
                    ? 'bg-orange-50 border-orange-300 text-orange-800'
                    : 'bg-blue-50 border-blue-300 text-blue-800'
                }`}>
                  {busStatus === 'approaching' ? <CheckCircle size={24} />
                    : busStatus === 'passed' ? <AlertTriangle size={24} />
                    : <Navigation2 size={24} />}
                  <div className="flex-1">
                    <p className="font-bold">
                      {busStatus === 'approaching' ? '🚌 Bus is approaching your stop!'
                        : busStatus === 'passed' ? '⚠️ Bus has passed your stop'
                        : `Bus is ${routeDistance || '?'} km away`}
                    </p>
                    {nextStop && (
                      <p className="text-sm mt-1">
                        Next stop: <span className="font-semibold">{nextStop.stopName}</span> (~{nextStop.distance} km away)
                      </p>
                    )}
                  </div>
                </div>
              )}

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

                    {/* ✅ Display stops based on direction */}
                    {displayStops.map((stop) => {
                      const isUserStop = stop._id === busStop._id;
                      const isNextStop = nextStop && stop._id === nextStop._id;
                      const stopIndex = displayStops.findIndex(s => s._id === stop._id);
                      const nextStopIndex = nextStop ? nextStop.index : -1;
                      const isPassed = nextStopIndex !== -1 && stopIndex < nextStopIndex;
                      
                      return (
                        <Marker
                          key={stop._id}
                          position={[stop.location.latitude, stop.location.longitude]}
                          icon={isUserStop ? stopIcon : isNextStop ? nextStopIcon : isPassed ? passedStopIcon : routeStopIcon}
                        >
                          <Popup>
                            <strong>{stop.stopName}</strong><br />
                            {stop.stopCode}
                            {isUserStop && <><br /><span className="text-blue-600 font-semibold">📍 You are here</span></>}
                            {isNextStop && <><br /><span className="text-orange-600 font-semibold">🎯 Next stop</span></>}
                            {isPassed && <><br /><span className="text-gray-500 font-semibold">✓ Passed</span></>}
                          </Popup>
                        </Marker>
                      );
                    })}

                    <Marker
                      position={[selectedBus.currentLocation.latitude, selectedBus.currentLocation.longitude]}
                      icon={busIcon}
                    >
                      <Popup>
                        <strong>{selectedBus.busName}</strong><br />
                        {selectedBus.busNumber}<br />
                        Speed: {selectedBus.speed?.toFixed(0) || 0} km/h
                        {destinationStop && <><br />Going to: {destinationStop.stopName}</>}
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
                    ).toFixed(2)} km
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
                  <div className="flex items-center gap-2"><div className="w-8 h-1 bg-blue-500"></div><span>Complete Route</span></div>
                  <div className="flex items-center gap-2"><div className="w-8 h-1 bg-green-500"></div><span>Road to Your Stop</span></div>
                  <div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-500 rounded-full"></div><span>Bus</span></div>
                  <div className="flex items-center gap-2"><div className="w-4 h-4 bg-red-500 rounded-full"></div><span>Your Stop</span></div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 bg-orange-500 rounded-full"></div><span>Next Stop</span></div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded-full"></div><span>Upcoming</span></div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 bg-gray-400 rounded-full opacity-60"></div><span>Passed</span></div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Route Progress</h3>
              
              {/* Destination Card */}
              {destinationStop && (
                <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-300 p-4 rounded-xl mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    {busDirection === 'forward' ? <ArrowRight size={20} className="text-purple-600" /> : <ArrowLeft size={20} className="text-purple-600" />}
                    <p className="text-sm text-purple-800 font-semibold">Destination</p>
                  </div>
                  <p className="font-bold text-lg text-purple-900">{destinationStop.stopName}</p>
                  <p className="text-sm text-purple-700 mt-1">{busDirection === 'forward' ? 'Forward Route' : 'Return Route'}</p>
                </div>
              )}

              {/* Next Stop Card */}
              {nextStop && (
                <div className="bg-gradient-to-br from-orange-50 to-yellow-50 border-2 border-orange-300 p-4 rounded-xl mb-4">
                  <p className="text-sm text-orange-800 font-semibold mb-1">🎯 Next Stop</p>
                  <p className="font-bold text-lg text-orange-900">{nextStop.stopName}</p>
                  <p className="text-sm text-orange-700 mt-1">~{nextStop.distance} km away</p>
                </div>
              )}

              <h4 className="font-semibold text-gray-700 mb-3 text-sm">All Stops ({displayStops.length})</h4>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {displayStops.map((stop, index) => {
                  const isUserStop = stop._id === busStop._id;
                  const isNextStop = nextStop && stop._id === nextStop._id;
                  const isPassed = nextStop && index < nextStop.index;

                  return (
                    <div
                      key={stop._id}
                      className={`flex items-center p-3 rounded-xl transition ${
                        isUserStop ? 'bg-blue-50 border-2 border-blue-500'
                          : isNextStop ? 'bg-orange-50 border-2 border-orange-400'
                          : isPassed ? 'bg-gray-100 opacity-60'
                          : 'bg-gray-50'
                      }`}
                    >
                      <div className={`rounded-full w-10 h-10 flex items-center justify-center font-bold mr-3 text-sm shrink-0 ${
                        isUserStop ? 'bg-blue-600 text-white'
                          : isNextStop ? 'bg-orange-500 text-white'
                          : isPassed ? 'bg-gray-400 text-white'
                          : 'bg-gray-300'
                      }`}>
                        {isPassed ? '✓' : index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold truncate ${isPassed ? 'line-through text-gray-500' : ''}`}>
                          {stop.stopName}
                        </p>
                        <p className="text-xs text-gray-600">{stop.stopCode}</p>
                      </div>
                      {isUserStop && (
                        <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shrink-0">You</span>
                      )}
                      {isNextStop && (
                        <span className="bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full shrink-0">Next</span>
                      )}
                    </div>
                  );
                })}
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