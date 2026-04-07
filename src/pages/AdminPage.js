import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Bus, Route as RouteIcon, MapPin, Plus, Trash2, Download, X, UserPlus, Edit, CheckCircle, AlertCircle, Activity, RefreshCw, Clock3, Camera, Menu } from 'lucide-react';
import api from '../services/api';

// ✅ Toast notification
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl text-white font-semibold transition-all animate-slide-in ${
      type === 'success' ? 'bg-green-600' : 'bg-red-600'
    }`}>
      {type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-75 hover:opacity-100">
        <X size={16} />
      </button>
    </div>
  );
};

const getInitials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, size, size);

        const scale = Math.max(size / image.width, size / image.height);
        const scaledWidth = image.width * scale;
        const scaledHeight = image.height * scale;
        const offsetX = (size - scaledWidth) / 2;
        const offsetY = (size - scaledHeight) / 2;

        context.drawImage(image, offsetX, offsetY, scaledWidth, scaledHeight);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const AdminPage = () => {
  const { user, logout, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('live');
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [busStops, setBusStops] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [liveDashboard, setLiveDashboard] = useState({
    stats: null,
    liveBuses: [],
    drivers: [],
    generatedAt: null
  });
  const [loading, setLoading] = useState(true);
  const [refreshingLiveOps, setRefreshingLiveOps] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({});
  const [showAssignDriverModal, setShowAssignDriverModal] = useState(false);
  const [selectedBusForDriver, setSelectedBusForDriver] = useState(null);
  const [toast, setToast] = useState(null);
  const [showListModal, setShowListModal] = useState(false);
  const [listModalType, setListModalType] = useState('');
  const [draggedIndex, setDraggedIndex] = useState(null); // ✅ NEW: For drag-and-drop

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const hideToast = useCallback(() => setToast(null), []);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    avatarUrl: '',
    bio: ''
  });
  const [externalStopResults, setExternalStopResults] = useState([]);
  const [searchingStops, setSearchingStops] = useState(false);
  const [externalStopSearchError, setExternalStopSearchError] = useState('');

  useEffect(() => {
    if (!user) return;

    setProfileForm({
      name: user.name || '',
      phone: user.phone || '',
      avatarUrl: user.avatarUrl || '',
      bio: user.bio || ''
    });
  }, [user]);

  useEffect(() => {
    fetchSharedData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTabData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'live') return undefined;

    fetchLiveDashboard({ silent: true });
    const intervalId = setInterval(() => {
      fetchLiveDashboard({ silent: true });
    }, 15000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (modalType !== 'stops' || !showModal) {
      setExternalStopResults([]);
      setSearchingStops(false);
      setExternalStopSearchError('');
      return undefined;
    }

    const query = (formData.stopName || '').trim();
    if (query.length < 3) {
      setExternalStopResults([]);
      setSearchingStops(false);
      setExternalStopSearchError('');
      return undefined;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchingStops(true);
      setExternalStopSearchError('');

      try {
        let results = [];

        try {
          const params = new URLSearchParams({
            q: `${query} bus stop`,
            format: 'jsonv2',
            limit: '8',
            addressdetails: '1',
            countrycodes: 'in'
          });
          const publicResponse = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);

          if (publicResponse.ok) {
            const publicData = await publicResponse.json();
            results = (publicData || []).map((item) => ({
              id: `nominatim-${item.place_id}`,
              name: item.name || item.display_name?.split(',')[0] || query,
              latitude: Number(item.lat),
              longitude: Number(item.lon),
              address: item.display_name || '',
              locality: item.address?.city || item.address?.town || item.address?.village || item.address?.suburb || ''
            })).filter((item) => !Number.isNaN(item.latitude) && !Number.isNaN(item.longitude));
          }
        } catch (publicError) {
          console.error('Public stop lookup failed:', publicError);
        }

        if (results.length === 0) {
          const res = await api.get('/bus-stops/external-search', {
            params: { q: query }
          });
          results = res.data.results || [];
        }

        if (!cancelled) {
          setExternalStopResults(results);
        }
      } catch (error) {
        if (!cancelled) {
          setExternalStopResults([]);
          setExternalStopSearchError(
            'Public bus stop lookup is unavailable right now.'
          );
        }
      } finally {
        if (!cancelled) {
          setSearchingStops(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [formData.stopName, modalType, showModal]);

  const fetchSharedData = async () => {
    try {
      const [routesRes, stopsRes] = await Promise.all([
        api.get('/routes').catch(() => ({ data: { routes: [] } })),
        api.get('/bus-stops').catch(() => ({ data: { busStops: [] } })),
        fetchDriversData()
      ]);
      setRoutes(routesRes.data.routes || []);
      setBusStops(stopsRes.data.busStops || []);
    } catch (error) {
      console.error('Shared data fetch error:', error);
    }
  };

  const fetchDriversData = async () => {
    try {
      try {
        const res = await api.get('/users/drivers');
        const driverList = res.data.drivers || [];
        setDrivers(driverList);
        return driverList;
      } catch {
        const res = await api.get('/users');
        const users = res.data.users || res.data || [];
        const driverList = users.filter(u => u.role === 'driver');
        setDrivers(driverList);
        return driverList;
      }
    } catch (error) {
      console.error('Fetch drivers error:', error);
      setDrivers([]);
      return [];
    }
  };

  const fetchTabData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'live') {
        await fetchLiveDashboard();
      } else if (activeTab === 'buses') {
        const res = await api.get('/buses');
        setBuses(res.data.buses || []);
      } else if (activeTab === 'routes') {
        const res = await api.get('/routes');
        setRoutes(res.data.routes || []);
      } else if (activeTab === 'stops') {
        const res = await api.get('/bus-stops');
        setBusStops(res.data.busStops || []);
      } else if (activeTab === 'drivers') {
        const [busesRes] = await Promise.all([
          api.get('/buses').catch(() => ({ data: { buses: [] } })),
          fetchAllUsers()
        ]);
        setBuses(busesRes.data.buses || []);
      }
    } catch (error) {
      console.error('Tab data fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLiveDashboard = async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshingLiveOps(true);
    }

    try {
      const res = await api.get('/users/live-dashboard');
      setLiveDashboard({
        stats: res.data.stats || null,
        liveBuses: res.data.liveBuses || [],
        drivers: res.data.drivers || [],
        generatedAt: res.data.generatedAt || null
      });
    } catch (error) {
      console.error('Fetch live dashboard error:', error);
      if (!silent) {
        showToast('Failed to load live operations data', 'error');
      }
    } finally {
      if (silent) {
        setRefreshingLiveOps(false);
      }
    }
  };

  const fetchAllUsers = async () => {
    try {
      try {
        const res = await api.get('/users/drivers');
        setAllUsers(res.data.drivers || []);
      } catch {
        const res = await api.get('/users');
        const users = res.data.users || res.data || [];
        setAllUsers(users.filter(u => u.role === 'driver'));
      }
    } catch (error) {
      console.error('Fetch all users error:', error);
      setAllUsers([]);
    }
  };

  const handleCreateOrUpdateBus = async (e) => {
    e.preventDefault();
    try {
      const busData = {
        busNumber: formData.busNumber,
        busName: formData.busName,
        capacity: parseInt(formData.capacity),
        routeId: formData.routeId,
        driverId: formData.driverId || null
      };

      if (editMode) {
        await api.put(`/buses/${editingId}`, busData);
        showToast('Bus updated successfully!');
      } else {
        await api.post('/buses', busData);
        showToast('Bus created successfully!');
      }

      closeModal();
      const res = await api.get('/buses');
      setBuses(res.data.buses || []);
    } catch (error) {
      showToast(error.response?.data?.message || `Failed to ${editMode ? 'update' : 'create'} bus`, 'error');
    }
  };

  const handleCreateOrUpdateRoute = async (e) => {
    e.preventDefault();
    try {
      const routeData = {
        routeName: formData.routeName,
        routeNumber: formData.routeNumber,
        stops: formData.stops || [],
        startTime: formData.startTime,
        endTime: formData.endTime,
        frequency: parseInt(formData.frequency) || 30
      };

      if (editMode) {
        await api.put(`/routes/${editingId}`, routeData);
        showToast('Route updated successfully!');
      } else {
        await api.post('/routes', routeData);
        showToast('Route created successfully!');
      }

      closeModal();
      const res = await api.get('/routes');
      setRoutes(res.data.routes || []);
    } catch (error) {
      showToast(error.response?.data?.message || `Failed to ${editMode ? 'update' : 'create'} route`, 'error');
    }
  };

  const handleCreateOrUpdateStop = async (e) => {
    e.preventDefault();
    try {
      const stopData = {
        stopName: formData.stopName,
        stopCode: formData.stopCode,
        location: {
          latitude: parseFloat(formData.latitude),
          longitude: parseFloat(formData.longitude)
        },
        address: formData.address
      };

      if (editMode) {
        await api.put(`/bus-stops/${editingId}`, stopData);
        showToast('Bus stop updated successfully!');
      } else {
        await api.post('/bus-stops', stopData);
        showToast('Bus stop created successfully!');
      }

      closeModal();
      const res = await api.get('/bus-stops');
      setBusStops(res.data.busStops || []);
    } catch (error) {
      showToast(error.response?.data?.message || `Failed to ${editMode ? 'update' : 'create'} bus stop`, 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      const endpoint = {
        buses: `/buses/${id}`,
        routes: `/routes/${id}`,
        stops: `/bus-stops/${id}`,
        drivers: `/users/${id}`
      }[activeTab];

      await api.delete(endpoint);
      showToast('Deleted successfully!');
      fetchTabData();

      if (activeTab === 'drivers') {
        fetchDriversData();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to delete';
      showToast(`Delete failed: ${errorMessage}`, 'error');
    }
  };

  const downloadQRCode = async (stopId, stopName) => {
    try {
      const res = await api.get(`/bus-stops/${stopId}/qr-code`);
      const link = document.createElement('a');
      link.href = res.data.qrCode;
      link.download = `${stopName.replace(/\s+/g, '_')}-QR.png`;
      link.click();
    } catch (error) {
      showToast('Failed to download QR code', 'error');
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditMode(false);
    setEditingId(null);
    setFormData({});
    setModalType('');
    setExternalStopResults([]);
    setSearchingStops(false);
    setExternalStopSearchError('');
  };

  const openModal = (type) => {
    setModalType(type);
    setShowModal(true);
    setEditMode(false);
    setEditingId(null);
    setFormData({});
    setExternalStopResults([]);
    setSearchingStops(false);
    setExternalStopSearchError('');
  };

  const openEditModal = (type, item) => {
    setModalType(type);
    setEditMode(true);
    setEditingId(item._id);
    setShowModal(true);

    if (type === 'buses') {
      setFormData({
        busNumber: item.busNumber,
        busName: item.busName,
        capacity: item.capacity,
        routeId: item.route?._id || '',
        driverId: item.driver?._id || ''
      });
    } else if (type === 'routes') {
      setFormData({
        routeName: item.routeName,
        routeNumber: item.routeNumber,
        stops: item.stops?.map(s => s._id) || [],
        startTime: item.startTime,
        endTime: item.endTime,
        frequency: item.frequency
      });
    } else if (type === 'stops') {
      setFormData({
        stopName: item.stopName,
        stopCode: item.stopCode,
        latitude: item.location?.latitude || '',
        longitude: item.location?.longitude || '',
        address: item.address || ''
      });
    }
  };

  // ✅ NEW: Stop management functions
  const addStopToRoute = (stopId) => {
    const currentStops = formData.stops || [];
    setFormData({ ...formData, stops: [...currentStops, stopId] });
  };

  const removeStopFromRoute = (index) => {
    const currentStops = formData.stops || [];
    const newStops = currentStops.filter((_, i) => i !== index);
    setFormData({ ...formData, stops: newStops });
  };

  const moveStopUp = (index) => {
    if (index === 0) return;
    const currentStops = [...(formData.stops || [])];
    [currentStops[index - 1], currentStops[index]] = [currentStops[index], currentStops[index - 1]];
    setFormData({ ...formData, stops: currentStops });
  };

  const moveStopDown = (index) => {
    const currentStops = [...(formData.stops || [])];
    if (index === currentStops.length - 1) return;
    [currentStops[index], currentStops[index + 1]] = [currentStops[index + 1], currentStops[index]];
    setFormData({ ...formData, stops: currentStops });
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const currentStops = [...(formData.stops || [])];
    const draggedStop = currentStops[draggedIndex];
    
    currentStops.splice(draggedIndex, 1);
    currentStops.splice(dropIndex, 0, draggedStop);
    
    setFormData({ ...formData, stops: currentStops });
    setDraggedIndex(null);
  };

  const openAssignDriverModal = (bus) => {
    setSelectedBusForDriver(bus);
    setShowAssignDriverModal(true);
  };

  const handleAssignDriver = async (driverId) => {
    try {
      await api.put(`/buses/${selectedBusForDriver._id}`, { driverId });
      setShowAssignDriverModal(false);
      showToast('Driver assigned successfully!');
      const res = await api.get('/buses');
      setBuses(res.data.buses || []);
    } catch (error) {
      showToast(error.response?.data?.message || 'Failed to assign driver', 'error');
    }
  };

  const handleUnassignDriver = async (busId) => {
    if (!window.confirm('Are you sure you want to unassign this driver?')) return;
    try {
      await api.put(`/buses/${busId}`, { driverId: null });
      showToast('Driver unassigned successfully!');
      const res = await api.get('/buses');
      setBuses(res.data.buses || []);
    } catch (error) {
      showToast(error.response?.data?.message || 'Failed to unassign driver', 'error');
    }
  };

  const handleSelectExternalStop = (stop) => {
    setFormData({
      ...formData,
      stopName: stop.name,
      latitude: stop.latitude ?? '',
      longitude: stop.longitude ?? '',
      address: stop.address || ''
    });
    setExternalStopResults([]);
    setExternalStopSearchError('');
  };

  const openProfileModal = () => {
    setShowHeaderMenu(false);
    setIsEditingProfile(false);
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setIsEditingProfile(false);
    setProfileForm({
      name: user?.name || '',
      phone: user?.phone || '',
      avatarUrl: user?.avatarUrl || '',
      bio: user?.bio || ''
    });
  };

  const handleProfileImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      setProfileForm((prev) => ({
        ...prev,
        avatarUrl: imageDataUrl
      }));
    } catch (error) {
      showToast('Failed to load the selected profile image', 'error');
    }
  };

  const handleRemoveProfileImage = () => {
    setProfileForm((prev) => ({
      ...prev,
      avatarUrl: ''
    }));
  };

  const handleProfileSave = async () => {
    setSavingProfile(true);

    try {
      await updateProfile(profileForm);
      setIsEditingProfile(false);
      showToast('Profile updated successfully!');
    } catch (error) {
      showToast(error.response?.data?.message || 'Failed to update profile', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const tabCount = {
    live: liveDashboard.stats?.liveBuses ?? 0,
    buses: buses.length,
    routes: routes.length,
    stops: busStops.length,
    drivers: drivers.length
  };

  const liveStats = liveDashboard.stats;
  const visibleLiveBuses = liveDashboard.liveBuses.slice(0, 6);
  const visibleDrivers = liveDashboard.drivers.slice(0, 6);

  return (
    <div className="min-h-screen bg-gray-100">
      {toast && <Toast message={toast.message} type={toast.type} onClose={hideToast} />}

      <header className="fixed top-0 left-0 right-0 z-40 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-800 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={openProfileModal}
              className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/30 shadow-lg hover:scale-105 transition shrink-0"
              title="Open profile"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/15 text-white flex items-center justify-center text-sm font-bold">
                  {getInitials(user?.name)}
                </div>
              )}
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-blue-200">Control Center</p>
              <h1 className="text-xl md:text-2xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-xs md:text-sm text-blue-100 mt-1">Manage operations, trips, buses, and drivers.</p>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowHeaderMenu((prev) => !prev)}
              className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white text-slate-900 hover:bg-blue-50 transition shadow-sm"
              title="Open menu"
            >
              <Menu size={20} />
            </button>
            {showHeaderMenu && (
              <div className="absolute right-0 mt-3 w-48 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                <button
                  onClick={openProfileModal}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition"
                >
                  Profile
                </button>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 pt-24 pb-6 mt-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4  mb-6">
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Fleet Overview</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{liveStats?.totalBuses ?? buses.length}</p>
            <p className="text-sm text-gray-500 mt-1">Total buses configured in the system</p>
          </div>
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Driver Readiness</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{liveStats?.totalDrivers ?? drivers.length}</p>
            <p className="text-sm text-gray-500 mt-1">Drivers ready to be assigned or dispatched</p>
          </div>
          <div className="bg-white rounded-2xl shadow-md p-5">
            <p className="text-sm font-semibold text-gray-500">Live Signals</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{liveStats?.liveBuses ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Buses sending fresh GPS updates right now</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="flex overflow-x-auto border-b">
            {[
              { key: 'live', label: 'Live Ops', icon: <Activity size={20} /> },
              { key: 'buses', label: 'Buses', icon: <Bus size={20} /> },
              { key: 'routes', label: 'Routes', icon: <RouteIcon size={20} /> },
              { key: 'stops', label: 'Bus Stops', icon: <MapPin size={20} /> },
              { key: 'drivers', label: 'Drivers', icon: <UserPlus size={20} /> },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-6 py-4 font-semibold transition whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {tab.icon}
                {tab.label} ({tabCount[tab.key]})
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">
              {activeTab === 'live' ? 'Live Operations Dashboard'
                : activeTab === 'buses' ? 'Manage Buses'
                : activeTab === 'routes' ? 'Manage Routes'
                : activeTab === 'stops' ? 'Manage Bus Stops'
                : 'Manage Drivers'}
            </h2>
            {activeTab === 'live' ? (
              <button
                onClick={() => fetchLiveDashboard({ silent: true })}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg transition"
              >
                <RefreshCw size={18} className={refreshingLiveOps ? 'animate-spin' : ''} />
                Refresh
              </button>
            ) : activeTab !== 'drivers' && (
              <button onClick={() => openModal(activeTab)} className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition">
                <Plus size={20} />
                Add New
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            </div>
          ) : (
            <div>
              {activeTab === 'live' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {[
                      {
                        label: 'Live Buses',
                        value: liveStats?.liveBuses ?? 0,
                        subtext: `${liveStats?.activeBuses ?? 0} active total`,
                        color: 'text-green-700',
                        bg: 'bg-green-50 border-green-200'
                      },
                      {
                        label: 'Stale Signals',
                        value: liveStats?.staleBuses ?? 0,
                        subtext: 'Active buses not updated in 2 min',
                        color: 'text-amber-700',
                        bg: 'bg-amber-50 border-amber-200'
                      },
                      {
                        label: 'Active Trips',
                        value: liveStats?.activeTrips ?? 0,
                        subtext: `${liveStats?.inactiveBuses ?? 0} buses inactive`,
                        color: 'text-blue-700',
                        bg: 'bg-blue-50 border-blue-200'
                      },
                      {
                        label: 'Driver Coverage',
                        value: `${liveStats?.assignedDrivers ?? 0}/${liveStats?.totalDrivers ?? 0}`,
                        subtext: `${liveStats?.unassignedDrivers ?? 0} drivers unassigned`,
                        color: 'text-purple-700',
                        bg: 'bg-purple-50 border-purple-200'
                      },
                      {
                        label: 'Routes',
                        value: liveStats?.activeRoutes ?? 0,
                        subtext: 'Currently active routes',
                        color: 'text-cyan-700',
                        bg: 'bg-cyan-50 border-cyan-200'
                      },
                      {
                        label: 'Stops',
                        value: liveStats?.activeStops ?? 0,
                        subtext: 'Active stops in service',
                        color: 'text-rose-700',
                        bg: 'bg-rose-50 border-rose-200'
                      }
                    ].map((card) => (
                      <div key={card.label} className={`border rounded-2xl p-5 ${card.bg}`}>
                        <p className="text-sm font-semibold text-gray-600">{card.label}</p>
                        <p className={`text-3xl font-bold mt-2 ${card.color}`}>{card.value}</p>
                        <p className="text-xs text-gray-500 mt-2">{card.subtext}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2 border rounded-2xl overflow-hidden">
                      <div className="px-5 py-4 bg-gray-50 border-b flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-800">Active Bus Feed</h3>
                          <p className="text-sm text-gray-500">Real-time health snapshot of buses currently in service</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {liveDashboard.liveBuses.length > 6 && (
                            <button
                              onClick={() => { setListModalType('buses'); setShowListModal(true); }}
                              className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                            >
                              View all
                            </button>
                          )}
                          {liveDashboard.generatedAt && (
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock3 size={14} />
                              Updated {new Date(liveDashboard.generatedAt).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              {['Bus', 'Route', 'Driver', 'Tracking', 'Trip', 'Last GPS'].map((header) => (
                                <th key={header} className="px-4 py-3 text-left text-sm font-semibold text-gray-700">{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {liveDashboard.liveBuses.length === 0 ? (
                              <tr>
                                <td colSpan="6" className="px-4 py-10 text-center text-gray-500">
                                  No active buses yet. Once a driver starts a trip, it will show up here.
                                </td>
                              </tr>
                            ) : (
                              visibleLiveBuses.map((busItem) => (
                                <tr key={busItem._id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3">
                                    <p className="font-semibold text-gray-900">{busItem.busName}</p>
                                    <p className="text-sm text-gray-500">{busItem.busNumber}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className="font-medium text-gray-800">{busItem.route?.routeName || 'No route'}</p>
                                    <p className="text-sm text-gray-500">{busItem.route?.routeNumber || 'N/A'}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <p className="font-medium text-gray-800">{busItem.driver?.name || 'Unassigned'}</p>
                                    <p className="text-sm text-gray-500">{busItem.driver?.phone || busItem.driver?.email || 'No contact'}</p>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                                      busItem.trackingStatus === 'live'
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}>
                                      {busItem.trackingStatus === 'live' ? 'Live signal' : 'Signal stale'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    {busItem.activeTrip ? (
                                      <div>
                                        <p className="font-medium text-gray-800">In progress</p>
                                        <p className="text-sm text-gray-500">
                                          Started {new Date(busItem.activeTrip.startTime).toLocaleTimeString()}
                                        </p>
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">No active trip</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    {busItem.lastUpdate ? (
                                      <div>
                                        <p className="text-sm font-medium text-gray-800">
                                          {new Date(busItem.lastUpdate).toLocaleTimeString()}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          {busItem.currentLocation?.latitude?.toFixed(4)}, {busItem.currentLocation?.longitude?.toFixed(4)}
                                        </p>
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">No GPS yet</span>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="border rounded-2xl p-5 bg-gray-50">
                      <h3 className="font-semibold text-gray-800">Driver Allocation</h3>
                      <p className="text-sm text-gray-500 mt-1 mb-4">Quick view of who is available versus assigned</p>

                      <div className="space-y-3 max-h-[30rem] overflow-y-auto">
                        {liveDashboard.drivers.length === 0 ? (
                          <p className="text-sm text-gray-500">No drivers found.</p>
                        ) : (
                          <>
                            {liveDashboard.drivers.length > 6 && (
                              <button
                                onClick={() => { setListModalType('drivers'); setShowListModal(true); }}
                                className="w-full text-left text-sm font-semibold text-blue-600 hover:text-blue-800"
                              >
                                View all drivers
                              </button>
                            )}
                            {visibleDrivers.map((driverItem) => {
                            const assignedBus = liveDashboard.liveBuses.find((busItem) => busItem.driver?._id === driverItem._id)
                              || buses.find((busItem) => busItem.driver?._id === driverItem._id);

                            return (
                              <div key={driverItem._id} className="bg-white border rounded-xl p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-gray-900">{driverItem.name}</p>
                                    <p className="text-sm text-gray-500">{driverItem.phone || driverItem.email || 'No contact info'}</p>
                                  </div>
                                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                                    assignedBus ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'
                                  }`}>
                                    {assignedBus ? 'Assigned' : 'Available'}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 mt-3">
                                  {assignedBus
                                    ? `${assignedBus.busName} (${assignedBus.busNumber})`
                                    : 'Ready to be assigned to a bus'}
                                </p>
                              </div>
                            );
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BUSES TAB */}
              {activeTab === 'buses' && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Bus Number', 'Bus Name', 'Capacity', 'Route', 'Driver', 'Status', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-sm font-semibold text-gray-700">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {buses.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="px-4 py-8 text-center text-gray-500">No buses found. Create your first bus!</td>
                        </tr>
                      ) : (
                        buses.map((bus) => (
                          <tr key={bus._id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-semibold">{bus.busNumber}</td>
                            <td className="px-4 py-3">{bus.busName}</td>
                            <td className="px-4 py-3">{bus.capacity}</td>
                            <td className="px-4 py-3">{bus.route?.routeName || 'Not Assigned'}</td>
                            <td className="px-4 py-3">
                              {bus.driver ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-green-600 font-semibold">{bus.driver.name}</span>
                                  <button
                                    onClick={() => handleUnassignDriver(bus._id)}
                                    className="text-xs text-red-500 hover:text-red-700 font-bold"
                                    title="Unassign driver"
                                  >✕</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => openAssignDriverModal(bus)}
                                  className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold text-sm"
                                >
                                  <UserPlus size={16} />
                                  Assign Driver
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                bus.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {bus.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                <button onClick={() => openEditModal('buses', bus)} className="text-blue-600 hover:text-blue-800 transition" title="Edit">
                                  <Edit size={18} />
                                </button>
                                <button onClick={() => handleDelete(bus._id)} className="text-red-600 hover:text-red-800 transition" title="Delete">
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ROUTES TAB */}
              {activeTab === 'routes' && (
                <div className="space-y-4">
                  {routes.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">No routes found. Create your first route!</div>
                  ) : (
                    routes.map((route) => (
                      <div key={route._id} className="border rounded-lg p-4 hover:shadow-md transition">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg text-gray-800">{route.routeName}</h3>
                            <p className="text-sm text-gray-600 mt-1">Route Number: <span className="font-semibold">{route.routeNumber}</span></p>
                            <p className="text-sm text-gray-600">Time: {route.startTime} - {route.endTime}</p>
                            <p className="text-sm text-gray-600">Frequency: Every {route.frequency} minutes</p>
                            <p className="text-sm text-gray-600 mt-2">
                              Stops: {route.stops?.length || 0}
                              {route.stops?.length > 0 && (
                                <span className="text-xs text-blue-600 ml-2">
                                  ({route.stops.map(s => s.stopName).join(' → ')})
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button onClick={() => openEditModal('routes', route)} className="text-blue-600 hover:text-blue-800 transition" title="Edit">
                              <Edit size={18} />
                            </button>
                            <button onClick={() => handleDelete(route._id)} className="text-red-600 hover:text-red-800 transition" title="Delete">
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* STOPS TAB */}
              {activeTab === 'stops' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {busStops.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-gray-500">No bus stops found. Create your first bus stop!</div>
                  ) : (
                    busStops.map((stop) => (
                      <div key={stop._id} className="border rounded-lg p-4 hover:shadow-md transition">
                        <h3 className="font-semibold text-lg mb-2 text-gray-800">{stop.stopName}</h3>
                        <p className="text-sm text-gray-600 mb-2">Code: <span className="font-semibold">{stop.stopCode}</span></p>
                        <p className="text-xs text-gray-500 mb-3">
                          📍 {stop.location.latitude.toFixed(4)}, {stop.location.longitude.toFixed(4)}
                        </p>
                        {stop.address && <p className="text-xs text-gray-500 mb-3">{stop.address}</p>}
                        {stop.qrCode && (
                          <img src={stop.qrCode} alt="QR Code" className="w-32 h-32 mb-3 mx-auto border rounded" />
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => downloadQRCode(stop._id, stop.stopName)}
                            className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm transition"
                          >
                            <Download size={16} />
                            QR
                          </button>
                          <button onClick={() => openEditModal('stops', stop)} className="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded transition">
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDelete(stop._id)} className="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded transition">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* DRIVERS TAB */}
              {activeTab === 'drivers' && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Name', 'Email', 'Phone', 'Assigned Bus', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-sm font-semibold text-gray-700">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {allUsers.length === 0 && drivers.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="px-4 py-8 text-center text-gray-500">
                            No drivers found. Register drivers at the /register page.
                          </td>
                        </tr>
                      ) : (
                        (allUsers.length > 0 ? allUsers : drivers).map((userItem) => {
                          const assignedBus = buses.find(bus => bus.driver?._id === userItem._id);
                          return (
                            <tr key={userItem._id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-semibold">{userItem.name}</td>
                              <td className="px-4 py-3">{userItem.email}</td>
                              <td className="px-4 py-3">{userItem.phone || 'N/A'}</td>
                              <td className="px-4 py-3">
                                {assignedBus ? (
                                  <span className="text-green-600 font-semibold">
                                    {assignedBus.busName} ({assignedBus.busNumber})
                                  </span>
                                ) : (
                                  <span className="text-gray-400">Not assigned</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {userItem._id !== user._id ? (
                                  <button onClick={() => handleDelete(userItem._id)} className="text-red-600 hover:text-red-800 transition" title="Delete">
                                    <Trash2 size={18} />
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">You</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CREATE/EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">
                {editMode ? 'Edit' : 'Add New'}{' '}
                {modalType === 'buses' ? 'Bus' : modalType === 'routes' ? 'Route' : 'Bus Stop'}
              </h3>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>

            <form onSubmit={
              modalType === 'buses' ? handleCreateOrUpdateBus
                : modalType === 'routes' ? handleCreateOrUpdateRoute
                : handleCreateOrUpdateStop
            }>
              {modalType === 'buses' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Bus Number *</label>
                    <input type="text" placeholder="e.g., TN001" value={formData.busNumber || ''} onChange={(e) => setFormData({ ...formData, busNumber: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Bus Name *</label>
                    <input type="text" placeholder="e.g., Express Bus 1" value={formData.busName || ''} onChange={(e) => setFormData({ ...formData, busName: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Capacity (Seats) *</label>
                    <input type="number" placeholder="e.g., 50" min="1" value={formData.capacity || ''} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Assign Route *</label>
                    <select value={formData.routeId || ''} onChange={(e) => setFormData({ ...formData, routeId: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required>
                      <option value="">Select a route</option>
                      {routes.map(route => (
                        <option key={route._id} value={route._id}>{route.routeName} ({route.routeNumber})</option>
                      ))}
                    </select>
                    {routes.length === 0 && <p className="text-sm text-red-600 mt-1">⚠️ Create a route first!</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Assign Driver (Optional)</label>
                    <select value={formData.driverId || ''} onChange={(e) => setFormData({ ...formData, driverId: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none">
                      <option value="">No driver assigned</option>
                      {drivers.map(driver => (
                        <option key={driver._id} value={driver._id}>{driver.name} ({driver.email})</option>
                      ))}
                    </select>
                    {drivers.length === 0 && <p className="text-sm text-gray-500 mt-1">💡 No drivers registered yet.</p>}
                  </div>
                </div>
              )}

              {modalType === 'routes' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Route Name *</label>
                    <input type="text" placeholder="e.g., City Center to Airport" value={formData.routeName || ''} onChange={(e) => setFormData({ ...formData, routeName: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Route Number *</label>
                    <input type="text" placeholder="e.g., R001" value={formData.routeNumber || ''} onChange={(e) => setFormData({ ...formData, routeNumber: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Start Time *</label>
                      <input type="time" value={formData.startTime || ''} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">End Time *</label>
                      <input type="time" value={formData.endTime || ''} onChange={(e) => setFormData({ ...formData, endTime: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Frequency (minutes)</label>
                    <input type="number" placeholder="e.g., 30" min="5" value={formData.frequency || '30'} onChange={(e) => setFormData({ ...formData, frequency: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" />
                  </div>
                  
                  {/* ✅ NEW: Ordered Stop Selection */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Add Bus Stops in Order
                      {formData.stops?.length > 0 && ` (${formData.stops.length} stops)`}
                    </label>
                    
                    {/* Available Stops */}
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 mb-2">📍 Available Stops (click to add):</p>
                      <div className="border-2 border-gray-300 rounded-lg p-3 max-h-40 overflow-y-auto bg-gray-50">
                        {busStops.length === 0 ? (
                          <p className="text-sm text-red-600">⚠️ Create bus stops first!</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {busStops
                              .filter(stop => !(formData.stops || []).includes(stop._id))
                              .map((stop) => (
                                <button
                                  key={stop._id}
                                  type="button"
                                  onClick={() => addStopToRoute(stop._id)}
                                  className="px-3 py-2 bg-white border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition text-sm font-semibold"
                                >
                                  + {stop.stopName}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ordered Stops List */}
                    <div>
                      <p className="text-sm text-gray-600 mb-2">
                        🚏 Route Order (drag to reorder, use arrows, or click ✕ to remove):
                      </p>
                      <div className="border-2 border-blue-300 rounded-lg p-3 min-h-[120px] bg-blue-50">
                        {(!formData.stops || formData.stops.length === 0) ? (
                          <div className="flex items-center justify-center h-20 text-gray-400">
                            <p className="text-sm">No stops added yet. Click stops above to add them.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {formData.stops.map((stopId, index) => {
                              const stop = busStops.find(s => s._id === stopId);
                              if (!stop) return null;
                              
                              return (
                                <div
                                  key={stopId}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, index)}
                                  onDragOver={(e) => handleDragOver(e, index)}
                                  onDrop={(e) => handleDrop(e, index)}
                                  className="flex items-center bg-white border-2 border-gray-300 rounded-lg p-3 cursor-move hover:border-blue-500 hover:shadow-md transition group"
                                >
                                  {/* Stop Number */}
                                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white font-bold mr-3 shrink-0">
                                    {index + 1}
                                  </div>
                                  
                                  {/* Stop Info */}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-gray-800 truncate">{stop.stopName}</p>
                                    <p className="text-xs text-gray-500">{stop.stopCode}</p>
                                  </div>
                                  
                                  {/* Move Up/Down Buttons */}
                                  <div className="flex flex-col gap-1 mr-2">
                                    <button
                                      type="button"
                                      onClick={() => moveStopUp(index)}
                                      disabled={index === 0}
                                      className={`p-1 rounded transition ${
                                        index === 0 
                                          ? 'text-gray-300 cursor-not-allowed' 
                                          : 'text-blue-600 hover:bg-blue-100'
                                      }`}
                                      title="Move up"
                                    >
                                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moveStopDown(index)}
                                      disabled={index === formData.stops.length - 1}
                                      className={`p-1 rounded transition ${
                                        index === formData.stops.length - 1
                                          ? 'text-gray-300 cursor-not-allowed'
                                          : 'text-blue-600 hover:bg-blue-100'
                                      }`}
                                      title="Move down"
                                    >
                                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                  </div>
                                  
                                  {/* Drag Handle */}
                                  <div className="text-gray-400 mr-2 opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing" title="Drag to reorder">
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"></path>
                                    </svg>
                                  </div>
                                  
                                  {/* Remove Button */}
                                  <button
                                    type="button"
                                    onClick={() => removeStopFromRoute(index)}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition shrink-0"
                                    title="Remove stop"
                                  >
                                    <X size={18} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      
                      {/* Helper Text */}
                      <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <p className="text-xs text-blue-800">
                          <strong>💡 Tip:</strong> The order matters! Stop 1 → Stop 2 → Stop 3. 
                          Drag stops up/down to reorder, use arrows, or remove and re-add them.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {modalType === 'stops' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Stop Name *</label>
                    <input type="text" placeholder="e.g., Central Station" value={formData.stopName || ''} onChange={(e) => setFormData({ ...formData, stopName: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    {searchingStops && (
                      <p className="text-xs text-blue-600 mt-2">Searching external bus stops...</p>
                    )}
                    {externalStopResults.length > 0 && (
                      <div className="mt-2 border border-gray-200 rounded-lg bg-gray-50 max-h-48 overflow-y-auto">
                        {externalStopResults.map((stop) => (
                          <button
                            key={stop.id}
                            type="button"
                            onClick={() => handleSelectExternalStop(stop)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-50 transition border-b last:border-b-0"
                          >
                            <p className="font-semibold text-gray-800">{stop.name}</p>
                            <p className="text-xs text-gray-500">
                              {Number(stop.latitude).toFixed(4)}, {Number(stop.longitude).toFixed(4)}
                              {stop.locality ? ` • ${stop.locality}` : ''}
                            </p>
                            {stop.address && (
                              <p className="text-xs text-gray-400 mt-1">{stop.address}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {externalStopSearchError && (
                      <p className="text-xs text-amber-600 mt-2">{externalStopSearchError}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      Search public bus-stop data to auto-fill coordinates, or enter your own latitude and longitude if the stop is not listed.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Stop Code *</label>
                    <input type="text" placeholder="e.g., CS001" value={formData.stopCode || ''} onChange={(e) => setFormData({ ...formData, stopCode: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Latitude *</label>
                      <input type="number" step="any" placeholder="e.g., 11.0168" value={formData.latitude || ''} onChange={(e) => setFormData({ ...formData, latitude: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Longitude *</label>
                      <input type="number" step="any" placeholder="e.g., 76.9558" value={formData.longitude || ''} onChange={(e) => setFormData({ ...formData, longitude: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Address</label>
                    <textarea placeholder="e.g., Near City Mall, Main Road" rows="3" value={formData.address || ''} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800"><strong>Tip:</strong> If the stop does not appear, you can still enter coordinates manually.</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={closeModal} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold px-4 py-3 rounded-lg transition">
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-3 rounded-lg transition">
                  {editMode ? 'Update' : 'Create'}{' '}
                  {modalType === 'buses' ? 'Bus' : modalType === 'routes' ? 'Route' : 'Bus Stop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-xl w-full">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">{isEditingProfile ? 'Edit Profile' : 'My Profile'}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {isEditingProfile
                    ? 'Update how your admin account appears across the dashboard.'
                    : 'View your admin details and open edit mode when you want to update them.'}
                </p>
              </div>
              <button onClick={closeProfileModal} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border">
                <div className="relative shrink-0">
                  {profileForm.avatarUrl ? (
                    <img src={profileForm.avatarUrl} alt={profileForm.name} className="w-20 h-20 rounded-full object-cover" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xl font-bold">
                      {getInitials(profileForm.name)}
                    </div>
                  )}
                  {isEditingProfile && (
                    <>
                      <label className="absolute inset-x-0 bottom-0 mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition">
                        <Camera size={14} />
                        <input type="file" accept="image/*" className="hidden" onChange={handleProfileImageUpload} />
                      </label>
                      {profileForm.avatarUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveProfileImage}
                          className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition"
                          title="Remove profile picture"
                        >
                          <span className="text-lg leading-none">-</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xl font-semibold text-slate-900">{profileForm.name || 'Admin User'}</p>
                  <p className="text-sm text-slate-500">{user?.email || 'No email available'}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-blue-600 mt-2">Administrator</p>
                </div>
              </div>

              {isEditingProfile ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={profileForm.name}
                      onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label>
                    <input
                      type="text"
                      value={profileForm.phone}
                      onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Bio</label>
                    <textarea
                      rows="3"
                      value={profileForm.bio}
                      onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                      placeholder="A short description about your role"
                      className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Full Name</p>
                    <p className="text-sm text-slate-900 mt-1">{profileForm.name || 'Not added yet'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Phone</p>
                    <p className="text-sm text-slate-900 mt-1">{profileForm.phone || 'Not added yet'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Bio</p>
                    <p className="text-sm text-slate-900 mt-1">{profileForm.bio || 'No bio added yet'}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeProfileModal} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold px-4 py-3 rounded-xl transition">
                  Close
                </button>
                {isEditingProfile ? (
                  <button type="button" onClick={handleProfileSave} disabled={savingProfile} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-3 rounded-xl transition disabled:opacity-60">
                    {savingProfile ? 'Saving...' : 'Save Profile'}
                  </button>
                ) : (
                  <button type="button" onClick={() => setIsEditingProfile(true)} className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-4 py-3 rounded-xl transition">
                    Edit Profile
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showListModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-5xl w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">
                  {listModalType === 'buses' ? 'All Active Buses' : 'All Drivers'}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {listModalType === 'buses' ? 'Complete live bus feed' : 'Complete driver allocation list'}
                </p>
              </div>
              <button onClick={() => setShowListModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>

            {listModalType === 'buses' ? (
              <div className="space-y-3">
                {liveDashboard.liveBuses.map((busItem) => (
                  <div key={busItem._id} className="border rounded-xl p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{busItem.busName} ({busItem.busNumber})</p>
                        <p className="text-sm text-gray-500">{busItem.route?.routeName || 'No route'} • {busItem.driver?.name || 'Unassigned driver'}</p>
                      </div>
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                        busItem.trackingStatus === 'live' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {busItem.trackingStatus === 'live' ? 'Live signal' : 'Signal stale'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {liveDashboard.drivers.map((driverItem) => {
                  const assignedBus = liveDashboard.liveBuses.find((busItem) => busItem.driver?._id === driverItem._id)
                    || buses.find((busItem) => busItem.driver?._id === driverItem._id);

                  return (
                    <div key={driverItem._id} className="border rounded-xl p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900">{driverItem.name}</p>
                          <p className="text-sm text-gray-500">{driverItem.phone || driverItem.email || 'No contact info'}</p>
                        </div>
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                          assignedBus ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'
                        }`}>
                          {assignedBus ? `${assignedBus.busName} (${assignedBus.busNumber})` : 'Available'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ASSIGN DRIVER MODAL */}
      {showAssignDriverModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Assign Driver</h3>
              <button onClick={() => setShowAssignDriverModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>
            <p className="text-gray-600 mb-4">
              Assign a driver to <strong>{selectedBusForDriver?.busName}</strong> ({selectedBusForDriver?.busNumber})
            </p>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {drivers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-2">No drivers available.</p>
                  <p className="text-sm text-gray-600">Register drivers at /register with role "Driver".</p>
                </div>
              ) : (
                drivers.map(driver => (
                  <button
                    key={driver._id}
                    onClick={() => handleAssignDriver(driver._id)}
                    className="w-full text-left p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition"
                  >
                    <p className="font-semibold text-gray-800">{driver.name}</p>
                    <p className="text-sm text-gray-600">{driver.email}</p>
                    {driver.phone && <p className="text-sm text-gray-500">{driver.phone}</p>}
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setShowAssignDriverModal(false)} className="w-full mt-4 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold px-4 py-2 rounded-lg transition">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
