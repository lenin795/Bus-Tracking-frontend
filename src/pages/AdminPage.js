import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Bus, Route as RouteIcon, MapPin, Plus, Trash2, Download, X, UserPlus } from 'lucide-react';
import api from '../services/api';

const AdminPage = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('buses');
  const [buses, setBuses] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [busStops, setBusStops] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState('');
  const [formData, setFormData] = useState({});
  const [showAssignDriverModal, setShowAssignDriverModal] = useState(false);
  const [selectedBusForDriver, setSelectedBusForDriver] = useState(null);

  useEffect(() => {
    fetchData();
    fetchDrivers();
    fetchAllRoutes();
    fetchAllStops();
    // eslint-disable-next-line
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'buses') {
        const res = await api.get('/buses');
        setBuses(res.data.buses);
      } else if (activeTab === 'routes') {
        const res = await api.get('/routes');
        setRoutes(res.data.routes);
      } else if (activeTab === 'stops') {
        const res = await api.get('/bus-stops');
        setBusStops(res.data.busStops);
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDrivers = async () => {
    try {
      const res = await api.get('/users/drivers');
      setDrivers(res.data.drivers);
    } catch (error) {
      console.error('Fetch drivers error:', error);
      setDrivers([]);
    }
  };

  const fetchAllRoutes = async () => {
    try {
      const res = await api.get('/routes');
      setRoutes(res.data.routes);
    } catch (error) {
      console.error('Fetch routes error:', error);
    }
  };

  const fetchAllStops = async () => {
    try {
      const res = await api.get('/bus-stops');
      setBusStops(res.data.busStops);
    } catch (error) {
      console.error('Fetch stops error:', error);
    }
  };

  const handleCreateBus = async (e) => {
    e.preventDefault();
    try {
      const busData = {
        busNumber: formData.busNumber,
        busName: formData.busName,
        capacity: parseInt(formData.capacity),
        routeId: formData.routeId,
        driverId: formData.driverId || null
      };
      await api.post('/buses', busData);
      setShowModal(false);
      fetchData();
      setFormData({});
      alert('Bus created successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to create bus');
    }
  };

  const handleCreateRoute = async (e) => {
    e.preventDefault();
    try {
      await api.post('/routes', {
        routeName: formData.routeName,
        routeNumber: formData.routeNumber,
        stops: formData.stops || [],
        startTime: formData.startTime,
        endTime: formData.endTime,
        frequency: parseInt(formData.frequency) || 30
      });
      setShowModal(false);
      fetchData();
      setFormData({});
      alert('Route created successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to create route');
    }
  };

  const handleCreateStop = async (e) => {
    e.preventDefault();
    try {
      await api.post('/bus-stops', {
        stopName: formData.stopName,
        stopCode: formData.stopCode,
        location: {
          latitude: parseFloat(formData.latitude),
          longitude: parseFloat(formData.longitude)
        },
        address: formData.address
      });
      setShowModal(false);
      fetchData();
      fetchAllStops();
      setFormData({});
      alert('Bus stop created successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to create bus stop');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      const endpoint = {
        buses: `/buses/${id}`,
        routes: `/routes/${id}`,
        stops: `/bus-stops/${id}`
      }[activeTab];
      await api.delete(endpoint);
      fetchData();
      alert('Deleted successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to delete');
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
      alert('Failed to download QR code');
    }
  };

  const openModal = (type) => {
    setModalType(type);
    setShowModal(true);
    setFormData({});
  };

  const toggleStopSelection = (stopId) => {
    const currentStops = formData.stops || [];
    if (currentStops.includes(stopId)) {
      setFormData({ ...formData, stops: currentStops.filter(id => id !== stopId) });
    } else {
      setFormData({ ...formData, stops: [...currentStops, stopId] });
    }
  };

  const openAssignDriverModal = (bus) => {
    setSelectedBusForDriver(bus);
    setShowAssignDriverModal(true);
  };

  const handleAssignDriver = async (driverId) => {
    try {
      await api.put(`/buses/${selectedBusForDriver._id}`, { driverId: driverId });
      setShowAssignDriverModal(false);
      fetchData();
      alert('Driver assigned successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to assign driver');
    }
  };

  const handleUnassignDriver = async (busId) => {
    if (!window.confirm('Are you sure you want to unassign this driver?')) return;
    try {
      await api.put(`/buses/${busId}`, { driverId: null });
      fetchData();
      alert('Driver unassigned successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to unassign driver');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
            <p className="text-gray-600">Welcome, {user.name}</p>
          </div>
          <button onClick={logout} className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition">
            <LogOut size={20} />
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="flex border-b">
            <button onClick={() => setActiveTab('buses')} className={`flex items-center gap-2 px-6 py-4 font-semibold transition ${activeTab === 'buses' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}>
              <Bus size={20} />
              Buses ({buses.length})
            </button>
            <button onClick={() => setActiveTab('routes')} className={`flex items-center gap-2 px-6 py-4 font-semibold transition ${activeTab === 'routes' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}>
              <RouteIcon size={20} />
              Routes ({routes.length})
            </button>
            <button onClick={() => setActiveTab('stops')} className={`flex items-center gap-2 px-6 py-4 font-semibold transition ${activeTab === 'stops' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}>
              <MapPin size={20} />
              Bus Stops ({busStops.length})
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">
              {activeTab === 'buses' ? 'Manage Buses' : activeTab === 'routes' ? 'Manage Routes' : 'Manage Bus Stops'}
            </h2>
            <button onClick={() => openModal(activeTab)} className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition">
              <Plus size={20} />
              Add New
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            </div>
          ) : (
            <div>
              {activeTab === 'buses' && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Bus Number</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Bus Name</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Capacity</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Route</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Driver</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
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
                                  <button onClick={() => handleUnassignDriver(bus._id)} className="text-xs text-red-600 hover:text-red-800" title="Unassign driver">
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => openAssignDriverModal(bus)} className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold text-sm">
                                  <UserPlus size={16} />
                                  Assign Driver
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${bus.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                {bus.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button onClick={() => handleDelete(bus._id)} className="text-red-600 hover:text-red-800 transition">
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

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
                                <span className="text-xs text-blue-600 ml-2">({route.stops.map(s => s.stopName).join(' → ')})</span>
                              )}
                            </p>
                          </div>
                          <button onClick={() => handleDelete(route._id)} className="text-red-600 hover:text-red-800 transition ml-4">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'stops' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {busStops.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-gray-500">No bus stops found. Create your first bus stop!</div>
                  ) : (
                    busStops.map((stop) => (
                      <div key={stop._id} className="border rounded-lg p-4 hover:shadow-md transition">
                        <h3 className="font-semibold text-lg mb-2 text-gray-800">{stop.stopName}</h3>
                        <p className="text-sm text-gray-600 mb-2">Code: <span className="font-semibold">{stop.stopCode}</span></p>
                        <p className="text-xs text-gray-500 mb-3">📍 {stop.location.latitude.toFixed(4)}, {stop.location.longitude.toFixed(4)}</p>
                        {stop.address && <p className="text-xs text-gray-500 mb-3">{stop.address}</p>}
                        {stop.qrCode && <img src={stop.qrCode} alt="QR Code" className="w-32 h-32 mb-3 mx-auto border rounded" />}
                        <div className="flex gap-2">
                          <button onClick={() => downloadQRCode(stop._id, stop.stopName)} className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 rounded text-sm transition">
                            <Download size={16} />
                            Download QR
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
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Add New {modalType === 'buses' ? 'Bus' : modalType === 'routes' ? 'Route' : 'Bus Stop'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={modalType === 'buses' ? handleCreateBus : modalType === 'routes' ? handleCreateRoute : handleCreateStop}>
              {modalType === 'buses' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Bus Number *</label>
                    <input type="text" placeholder="e.g., TN001" value={formData.busNumber || ''} onChange={(e) => setFormData({...formData, busNumber: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Bus Name *</label>
                    <input type="text" placeholder="e.g., Express Bus 1" value={formData.busName || ''} onChange={(e) => setFormData({...formData, busName: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Capacity (Seats) *</label>
                    <input type="number" placeholder="e.g., 50" min="1" value={formData.capacity || ''} onChange={(e) => setFormData({...formData, capacity: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Assign Route *</label>
                    <select value={formData.routeId || ''} onChange={(e) => setFormData({...formData, routeId: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required>
                      <option value="">Select a route</option>
                      {routes.map(route => (
                        <option key={route._id} value={route._id}>{route.routeName} ({route.routeNumber})</option>
                      ))}
                    </select>
                    {routes.length === 0 && <p className="text-sm text-red-600 mt-1">⚠️ Create a route first!</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Assign Driver (Optional)</label>
                    <select value={formData.driverId || ''} onChange={(e) => setFormData({...formData, driverId: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none">
                      <option value="">No driver assigned</option>
                      {drivers.map(driver => (
                        <option key={driver._id} value={driver._id}>{driver.name} ({driver.email})</option>
                      ))}
                    </select>
                    {drivers.length === 0 && <p className="text-sm text-gray-500 mt-1">💡 No drivers registered. Register drivers at /register page.</p>}
                  </div>
                </div>
              )}
              
              {modalType === 'routes' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Route Name *</label>
                    <input type="text" placeholder="e.g., City Center to Airport" value={formData.routeName || ''} onChange={(e) => setFormData({...formData, routeName: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Route Number *</label>
                    <input type="text" placeholder="e.g., R001" value={formData.routeNumber || ''} onChange={(e) => setFormData({...formData, routeNumber: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Start Time *</label>
                      <input type="time" value={formData.startTime || ''} onChange={(e) => setFormData({...formData, startTime: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">End Time *</label>
                      <input type="time" value={formData.endTime || ''} onChange={(e) => setFormData({...formData, endTime: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Frequency (minutes)</label>
                    <input type="number" placeholder="e.g., 30" min="5" value={formData.frequency || '30'} onChange={(e) => setFormData({...formData, frequency: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Select Bus Stops (in order) {formData.stops?.length > 0 && `(${formData.stops.length} selected)`}</label>
                    <div className="border-2 border-gray-300 rounded-lg p-4 max-h-60 overflow-y-auto">
                      {busStops.length === 0 ? (
                        <p className="text-sm text-red-600">⚠️ Create bus stops first!</p>
                      ) : (
                        <div className="space-y-2">
                          {busStops.map((stop) => (
                            <label key={stop._id} className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer">
                              <input type="checkbox" checked={(formData.stops || []).includes(stop._id)} onChange={() => toggleStopSelection(stop._id)} className="mr-3 h-5 w-5" />
                              <div>
                                <span className="font-semibold">{stop.stopName}</span>
                                <span className="text-sm text-gray-500 ml-2">({stop.stopCode})</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {modalType === 'stops' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Stop Name *</label>
                    <input type="text" placeholder="e.g., Central Station" value={formData.stopName || ''} onChange={(e) => setFormData({...formData, stopName: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Stop Code *</label>
                    <input type="text" placeholder="e.g., CS001" value={formData.stopCode || ''} onChange={(e) => setFormData({...formData, stopCode: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Latitude *</label>
                      <input type="number" step="any" placeholder="e.g., 11.0168" value={formData.latitude || ''} onChange={(e) => setFormData({...formData, latitude: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Longitude *</label>
                      <input type="number" step="any" placeholder="e.g., 76.9558" value={formData.longitude || ''} onChange={(e) => setFormData({...formData, longitude: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Address</label>
                    <textarea placeholder="e.g., Near City Mall, Main Road" rows="3" value={formData.address || ''} onChange={(e) => setFormData({...formData, address: e.target.value})} className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">💡 <strong>Tip:</strong> You can use Google Maps to get coordinates. Right-click on a location and select the coordinates to copy them.</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold px-4 py-3 rounded-lg transition">Cancel</button>
                <button type="submit" className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-3 rounded-lg transition">
                  Create {modalType === 'buses' ? 'Bus' : modalType === 'routes' ? 'Route' : 'Bus Stop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAssignDriverModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Assign Driver</h3>
              <button onClick={() => setShowAssignDriverModal(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>
            <p className="text-gray-600 mb-4">Assign a driver to <strong>{selectedBusForDriver?.busName}</strong> ({selectedBusForDriver?.busNumber})</p>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {drivers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-4">No drivers available.</p>
                  <p className="text-sm text-gray-600">Register drivers at the /register page with role "Driver".</p>
                </div>
              ) : (
                drivers.map(driver => (
                  <button key={driver._id} onClick={() => handleAssignDriver(driver._id)} className="w-full text-left p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition">
                    <p className="font-semibold text-gray-800">{driver.name}</p>
                    <p className="text-sm text-gray-600">{driver.email}</p>
                    {driver.phone && <p className="text-sm text-gray-500">{driver.phone}</p>}
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setShowAssignDriverModal(false)} className="w-full mt-4 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold px-4 py-2 rounded-lg transition">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;