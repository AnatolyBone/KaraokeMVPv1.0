import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { supabase } from '../services/supabaseClient';
import { localization } from '../utils/localization';
import { 
  X, Users, Music, Layers, Cpu, ShieldAlert, Trash2, Shield, User, 
  Search, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle 
} from 'lucide-react';
import { UserProfile } from '../types';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'users' | 'songs' | 'published' | 'stems';

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({ isOpen, onClose }) => {
  const { theme, language } = useKaraokeStore();
  const dict = localization[language];

  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Data lists
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [songs, setSongs] = useState<any[]>([]);
  const [published, setPublished] = useState<any[]>([]);
  const [stems, setStems] = useState<any[]>([]);

  // Super Admin check
  const superAdminTgId = Number(import.meta.env.VITE_SUPER_ADMIN_TG_ID || '11111111');

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'users') {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setProfiles(data || []);
      } else if (activeTab === 'songs') {
        const { data, error } = await supabase
          .from('songs')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setSongs(data || []);
      } else if (activeTab === 'published') {
        const { data, error } = await supabase
          .from('published_karaoke')
          .select(`
            *,
            songs (artist, title),
            profiles (username, telegram_id)
          `)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setPublished(data || []);
      } else if (activeTab === 'stems') {
        const { data, error } = await supabase
          .from('song_stems')
          .select(`
            *,
            songs (artist, title)
          `)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setStems(data || []);
      }
    } catch (err) {
      console.error(`Failed to fetch ${activeTab}:`, err);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (profileId: string, currentRole: string, telegramId: number) => {
    // Block modifying super admins
    if (telegramId === superAdminTgId || telegramId === 8668851942) {
      alert(dict.adminSuperAdminAlert);
      return;
    }

    const nextRole = currentRole === 'free' ? 'pro' : currentRole === 'pro' ? 'admin' : 'free';
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: nextRole })
        .eq('id', profileId);

      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert(`Error updating role: ${err.message}`);
    }
  };

  const handleDeleteItem = async (table: string, id: string, extraCheck?: boolean, telegramId?: number) => {
    // Block deleting super admins
    if (table === 'profiles' && (telegramId === superAdminTgId || telegramId === 8668851942)) {
      alert(dict.adminSuperAdminAlert);
      return;
    }

    if (!confirm(dict.adminDeleteConfirm)) return;

    try {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id);

      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert(`Error deleting item: ${err.message}`);
    }
  };

  if (!isOpen) return null;

  // Filter handlers
  const getFilteredProfiles = () => {
    return profiles.filter(p => 
      p.username?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.telegram_id?.toString().includes(searchQuery)
    );
  };

  const getFilteredSongs = () => {
    return songs.filter(s => 
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const getFilteredPublished = () => {
    return published.filter(p => 
      p.songs?.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.songs?.artist?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.profiles?.username?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const getFilteredStems = () => {
    return stems.filter(s => 
      s.songs?.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      s.songs?.artist?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.status.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop with premium blur */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div 
        className={`relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden transition-all duration-300 ${
          theme === 'dark' 
            ? 'bg-zinc-950/90 border-zinc-800 text-zinc-100 shadow-zinc-950/50' 
            : 'bg-white border-zinc-200 text-zinc-900 shadow-zinc-300/30'
        }`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-150 dark:border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-md shadow-red-500/10 animate-pulse">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight">{dict.adminTitle}</h3>
              <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                Supabase V2 Controls
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Tabs Navigation */}
        <div className="flex border-b border-zinc-150 dark:border-zinc-900 p-2 gap-1 overflow-x-auto bg-zinc-100/50 dark:bg-zinc-950/50 shrink-0">
          <button
            onClick={() => { setActiveTab('users'); setSearchQuery(''); }}
            className={`flex-1 min-w-[100px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'users'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-250/10'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Users size={14} />
            {dict.adminTabUsers}
          </button>
          
          <button
            onClick={() => { setActiveTab('songs'); setSearchQuery(''); }}
            className={`flex-1 min-w-[100px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'songs'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-250/10'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Music size={14} />
            {dict.adminTabSongs}
          </button>

          <button
            onClick={() => { setActiveTab('published'); setSearchQuery(''); }}
            className={`flex-1 min-w-[100px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'published'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-250/10'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Layers size={14} />
            {dict.adminTabPublished}
          </button>

          <button
            onClick={() => { setActiveTab('stems'); setSearchQuery(''); }}
            className={`flex-1 min-w-[100px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'stems'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-250/10'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Cpu size={14} />
            {dict.adminTabStems}
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 border-b border-zinc-150 dark:border-zinc-900 flex gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" size={14} />
            <input 
              type="text"
              placeholder={dict.adminSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/30 dark:bg-zinc-900/30 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:border-red-500/50"
            />
          </div>
          <button 
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 disabled:opacity-50 transition-all flex items-center gap-1.5 font-semibold text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Table Content Area */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[250px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-10">
              <RefreshCw size={24} className="text-red-500 animate-spin" />
              <span className="text-xs text-zinc-400 font-bold uppercase">{dict.searching}</span>
            </div>
          ) : (
            <>
              {/* Tab Users */}
              {activeTab === 'users' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-850 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
                        <th className="py-2.5 px-3">{dict.adminUserColName}</th>
                        <th className="py-2.5 px-3">{dict.adminUserColRole}</th>
                        <th className="py-2.5 px-3">{dict.adminUserColTg}</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredProfiles().map((profile) => {
                        const isSuper = profile.telegram_id === superAdminTgId || profile.telegram_id === 8668851942;
                        return (
                          <tr key={profile.id} className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-100/20 dark:hover:bg-zinc-900/20">
                            <td className="py-3 px-3 flex items-center gap-2">
                              {profile.avatar_url ? (
                                <img src={profile.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center">
                                  <User size={12} />
                                </div>
                              )}
                              <div>
                                <p className="font-bold flex items-center gap-1">
                                  {profile.username || 'No username'}
                                  {isSuper && <Shield size={12} className="text-red-500 fill-red-500/10" title="Super Admin" />}
                                </p>
                                <p className="text-[9px] text-zinc-450 dark:text-zinc-500 font-mono truncate max-w-[120px]" title={profile.id}>
                                  {profile.id}
                                </p>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                profile.role === 'admin' 
                                  ? 'bg-red-500/10 text-red-500' 
                                  : profile.role === 'pro' 
                                    ? 'bg-violet-500/10 text-violet-500' 
                                    : 'bg-zinc-500/10 text-zinc-500'
                              }`}>
                                {profile.role === 'admin' 
                                  ? dict.adminRoleAdmin 
                                  : profile.role === 'pro' 
                                    ? dict.adminRolePro 
                                    : dict.adminRoleFree}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-zinc-500">{profile.telegram_id}</td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  disabled={isSuper}
                                  onClick={() => handleRoleChange(profile.id, profile.role, profile.telegram_id)}
                                  className="px-2 py-1 text-[10px] font-bold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-30 transition-colors"
                                >
                                  {dict.adminActionChangeRole}
                                </button>
                                <button
                                  disabled={isSuper}
                                  onClick={() => handleDeleteItem('profiles', profile.id, true, profile.telegram_id)}
                                  className="p-1.5 text-zinc-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {getFilteredProfiles().length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-zinc-450 dark:text-zinc-500 font-bold">
                            {dict.searchNoResults}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab Songs */}
              {activeTab === 'songs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-850 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
                        <th className="py-2.5 px-3">Title / Artist</th>
                        <th className="py-2.5 px-3">BPM</th>
                        <th className="py-2.5 px-3">LRCLIB ID</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredSongs().map((song) => (
                        <tr key={song.id} className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-100/20 dark:hover:bg-zinc-900/20">
                          <td className="py-3 px-3">
                            <p className="font-bold text-zinc-800 dark:text-zinc-200">{song.title}</p>
                            <p className="text-[10px] text-zinc-500">{song.artist}</p>
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-violet-500">{song.bpm || '-'}</td>
                          <td className="py-3 px-3 font-mono text-zinc-500">{song.lrclib_id || '-'}</td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => handleDeleteItem('songs', song.id)}
                              className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {getFilteredSongs().length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-zinc-450 dark:text-zinc-500 font-bold">
                            {dict.searchNoResults}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab Published */}
              {activeTab === 'published' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-850 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
                        <th className="py-2.5 px-3">Song info</th>
                        <th className="py-2.5 px-3">Publisher</th>
                        <th className="py-2.5 px-3">Stats</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredPublished().map((pub) => (
                        <tr key={pub.id} className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-100/20 dark:hover:bg-zinc-900/20">
                          <td className="py-3 px-3">
                            <p className="font-bold text-zinc-800 dark:text-zinc-200">{pub.songs?.title || 'Unknown Title'}</p>
                            <p className="text-[10px] text-zinc-500">{pub.songs?.artist || 'Unknown Artist'}</p>
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-zinc-650 dark:text-zinc-350">{pub.profiles?.username || 'Guest'}</p>
                            <p className="text-[9px] text-zinc-500 font-mono">TG: {pub.profiles?.telegram_id || '-'}</p>
                          </td>
                          <td className="py-3 px-3 font-mono text-zinc-500">
                            <span>Likes: {pub.likes_count || 0}</span> • <span>Plays: {pub.plays_count || 0}</span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => handleDeleteItem('published_karaoke', pub.id)}
                              className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {getFilteredPublished().length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-zinc-450 dark:text-zinc-500 font-bold">
                            {dict.searchNoResults}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab Stems */}
              {activeTab === 'stems' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-850 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
                        <th className="py-2.5 px-3">Song info</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Created</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredStems().map((stem) => {
                        const statusClass = 
                          stem.status === 'completed' 
                            ? 'bg-green-500/10 text-green-500' 
                            : stem.status === 'processing'
                              ? 'bg-blue-500/10 text-blue-500'
                              : stem.status === 'failed'
                                ? 'bg-red-500/10 text-red-500'
                                : 'bg-yellow-500/10 text-yellow-500';
                        const statusLabel = 
                          stem.status === 'completed'
                            ? dict.adminStatusCompleted
                            : stem.status === 'processing'
                              ? dict.adminStatusProcessing
                              : stem.status === 'failed'
                                ? dict.adminStatusFailed
                                : dict.adminStatusPending;
                        return (
                          <tr key={stem.id} className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-100/20 dark:hover:bg-zinc-900/20">
                            <td className="py-3 px-3">
                              <p className="font-bold text-zinc-800 dark:text-zinc-200">{stem.songs?.title || 'Unknown Title'}</p>
                              <p className="text-[10px] text-zinc-500">{stem.songs?.artist || 'Unknown Artist'}</p>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusClass}`}>
                                {statusLabel}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-zinc-450 dark:text-zinc-500 font-mono">
                              {new Date(stem.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <button
                                onClick={() => handleDeleteItem('song_stems', stem.id)}
                                className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {getFilteredStems().length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-10 text-center text-zinc-450 dark:text-zinc-500 font-bold">
                            {dict.searchNoResults}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer with Warning / Alert */}
        <div className="px-6 py-4 border-t border-zinc-150 dark:border-zinc-900 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/20 shrink-0">
          <div className="flex items-center gap-2 text-red-500 dark:text-red-400 text-[10px] font-semibold">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{dict.adminSuperAdminAlert}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-850 dark:hover:bg-zinc-800 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] cursor-pointer"
          >
            {dict.adminClose}
          </button>
        </div>
      </div>
    </div>
  );
};
