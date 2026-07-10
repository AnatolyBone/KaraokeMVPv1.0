import React, { useEffect, useState } from 'react';
import { useKaraokeStore } from '../store/useKaraokeStore';
import { supabase } from '../services/supabaseClient';
import { localization } from '../utils/localization';
import { 
  X, Users, Music, Layers, Cpu, ShieldAlert, Trash2, Shield, User, 
  Search, RefreshCw, AlertTriangle, Settings, FileText, MessageSquare, Clipboard,
  Activity, Eye, UploadCloud, Video, UserPlus, Clock, UserX
} from 'lucide-react';
import { UserProfile } from '../types';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: 'modal' | 'page';
}

type TabType = 'users' | 'testers' | 'songs' | 'published' | 'stems' | 'feedback' | 'settings' | 'logs';

type KaraokeTester = {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  source: string | null;
  status: 'tester_active' | 'tester_waitlist' | 'tester_expired' | string;
  plus_started_at: string | null;
  plus_until: string | null;
  accepted_at: string | null;
  feedback_count: number | null;
  created_at: string;
  updated_at: string | null;
};

type TesterInsights = {
  openedSite: boolean;
  importedAudio: boolean;
  startedExport: boolean;
  completedExport: boolean;
  sentFeedback: boolean;
  lastSeenAt: string | null;
  lastImportAt: string | null;
  lastExportAt: string | null;
  feedbackCount: number;
};

type AdminKpiStats = {
  usersToday: number | null;
  uniqueToday: number | null;
  appOpensToday: number | null;
  screenViewsToday: number | null;
  publicOpensToday: number | null;
  exportsCompletedToday: number | null;
  publicationsToday: number | null;
  feedbackNew: number | null;
};

const emptyKpiStats: AdminKpiStats = {
  usersToday: null,
  uniqueToday: null,
  appOpensToday: null,
  screenViewsToday: null,
  publicOpensToday: null,
  exportsCompletedToday: null,
  publicationsToday: null,
  feedbackNew: null,
};

const emptyTesterInsight = (): TesterInsights => ({
  openedSite: false,
  importedAudio: false,
  startedExport: false,
  completedExport: false,
  sentFeedback: false,
  lastSeenAt: null,
  lastImportAt: null,
  lastExportAt: null,
  feedbackCount: 0,
});

function maxIso(current: string | null, next?: string | null) {
  if (!next) return current;
  if (!current) return next;
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

async function countRows(table: string, filter?: (query: any) => any) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) {
    console.warn(`Failed to count ${table}:`, error);
    return null;
  }
  return count || 0;
}

async function countDistinctVisitors(sinceIso: string) {
  const { data, error } = await supabase
    .from('app_events')
    .select('user_id, telegram_id, anonymous_id')
    .gte('created_at', sinceIso)
    .limit(10000);

  if (error) {
    console.warn('Failed to count distinct visitors:', error);
    return null;
  }

  const anonymousToKnownUser = new Map<string, string>();
  (data || []).forEach((row: any) => {
    const knownId = row.user_id || (row.telegram_id ? `tg:${row.telegram_id}` : null);
    if (knownId && row.anonymous_id) {
      anonymousToKnownUser.set(row.anonymous_id, knownId);
    }
  });

  const unique = new Set<string>();
  (data || []).forEach((row: any) => {
    const knownId = row.user_id || (row.telegram_id ? `tg:${row.telegram_id}` : null);
    const resolvedAnonymousId = row.anonymous_id ? anonymousToKnownUser.get(row.anonymous_id) : null;
    const id = knownId || resolvedAnonymousId || (row.anonymous_id ? `anon:${row.anonymous_id}` : null);
    if (id) unique.add(id);
  });

  return unique.size;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({ isOpen, onClose, variant = 'modal' }) => {
  const { theme, language } = useKaraokeStore();
  const dict = localization[language];
  const isPage = variant === 'page';

  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Data lists
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [testers, setTesters] = useState<KaraokeTester[]>([]);
  const [testerInsights, setTesterInsights] = useState<Record<number, TesterInsights>>({});
  const [songs, setSongs] = useState<any[]>([]);
  const [published, setPublished] = useState<any[]>([]);
  const [stems, setStems] = useState<any[]>([]);
  const [settingsList, setSettingsList] = useState<any[]>([]);
  const [debugLogs, setDebugLogs] = useState<any[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<any[]>([]);
  const [feedbackFilter, setFeedbackFilter] = useState<string>('all');
  const [kpiStats, setKpiStats] = useState<AdminKpiStats>(emptyKpiStats);
  const [kpiLoading, setKpiLoading] = useState(false);
  
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [expandedFeedbackId, setExpandedFeedbackId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newTesterTelegramId, setNewTesterTelegramId] = useState('');
  const [newTesterUsername, setNewTesterUsername] = useState('');
  const [testerDays, setTesterDays] = useState(30);
  const [testerLimit, setTesterLimit] = useState('50');

  // Super Admin check
  const superAdminTgId = Number(import.meta.env.VITE_SUPER_ADMIN_TG_ID || '11111111');

  useEffect(() => {
    if (isOpen) {
      fetchData();
      fetchKpiStats();
    }
  }, [isOpen, activeTab]);

  const fetchKpiStats = async () => {
    setKpiLoading(true);
    const todayIso = startOfTodayIso();
    try {
      const [
        usersToday,
        uniqueToday,
        appOpensToday,
        screenViewsToday,
        publicOpensToday,
        exportsCompletedToday,
        publicationsToday,
        feedbackNew,
      ] = await Promise.all([
        countRows('profiles', (q) => q.gte('created_at', todayIso)),
        countDistinctVisitors(todayIso),
        countRows('app_events', (q) => q.eq('event_name', 'app_open').gte('created_at', todayIso)),
        countRows('app_events', (q) => q.eq('event_name', 'screen_view').gte('created_at', todayIso)),
        countRows('app_events', (q) => q.eq('event_name', 'public_karaoke_opened').gte('created_at', todayIso)),
        countRows('app_events', (q) => q.eq('event_name', 'video_export_completed').gte('created_at', todayIso)),
        countRows('published_karaoke', (q) => q.gte('created_at', todayIso)),
        countRows('feedback', (q) => q.eq('status', 'new')),
      ]);

      setKpiStats({
        usersToday,
        uniqueToday,
        appOpensToday,
        screenViewsToday,
        publicOpensToday,
        exportsCompletedToday,
        publicationsToday,
        feedbackNew,
      });
    } finally {
      setKpiLoading(false);
    }
  };

  const loadTesterInsights = async (testerRows: KaraokeTester[]) => {
    const testerIds = Array.from(new Set(testerRows.map((tester) => tester.telegram_id).filter(Boolean)));
    if (testerIds.length === 0) {
      setTesterInsights({});
      return;
    }

    const [eventsResult, sharesResult, feedbackResult] = await Promise.all([
      supabase
        .from('app_events')
        .select('telegram_id,event_name,created_at')
        .in('telegram_id', testerIds)
        .in('event_name', [
          'app_open',
          'screen_view',
          'telegram_audio_imported',
          'video_export_started',
          'video_export_completed',
        ])
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from('telegram_audio_shares')
        .select('telegram_id,created_at')
        .in('telegram_id', testerIds)
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from('feedback')
        .select('telegram_id,created_at')
        .in('telegram_id', testerIds)
        .order('created_at', { ascending: false })
        .limit(5000),
    ]);

    if (eventsResult.error) console.warn('Failed to fetch tester events:', eventsResult.error);
    if (sharesResult.error) console.warn('Failed to fetch tester Telegram shares:', sharesResult.error);
    if (feedbackResult.error) console.warn('Failed to fetch tester feedback:', feedbackResult.error);

    const nextInsights: Record<number, TesterInsights> = {};
    const getInsight = (telegramId: number) => {
      if (!nextInsights[telegramId]) nextInsights[telegramId] = emptyTesterInsight();
      return nextInsights[telegramId];
    };

    (eventsResult.data || []).forEach((event: any) => {
      if (!event.telegram_id) return;
      const insight = getInsight(event.telegram_id);
      if (event.event_name === 'app_open' || event.event_name === 'screen_view') {
        insight.openedSite = true;
        insight.lastSeenAt = maxIso(insight.lastSeenAt, event.created_at);
      }
      if (event.event_name === 'telegram_audio_imported') {
        insight.importedAudio = true;
        insight.lastImportAt = maxIso(insight.lastImportAt, event.created_at);
      }
      if (event.event_name === 'video_export_started') {
        insight.startedExport = true;
        insight.lastExportAt = maxIso(insight.lastExportAt, event.created_at);
      }
      if (event.event_name === 'video_export_completed') {
        insight.startedExport = true;
        insight.completedExport = true;
        insight.lastExportAt = maxIso(insight.lastExportAt, event.created_at);
      }
    });

    (sharesResult.data || []).forEach((share: any) => {
      if (!share.telegram_id) return;
      const insight = getInsight(share.telegram_id);
      insight.importedAudio = true;
      insight.lastImportAt = maxIso(insight.lastImportAt, share.created_at);
    });

    (feedbackResult.data || []).forEach((feedback: any) => {
      if (!feedback.telegram_id) return;
      const insight = getInsight(feedback.telegram_id);
      insight.sentFeedback = true;
      insight.feedbackCount += 1;
    });

    setTesterInsights(nextInsights);
  };

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
      } else if (activeTab === 'testers') {
        const [{ data: testerData, error: testerError }, { data: limitData, error: limitError }] = await Promise.all([
          supabase
            .from('karaoke_testers')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase
            .from('telegram_bot_settings')
            .select('value')
            .eq('key', 'karaoke_tester_limit')
            .maybeSingle(),
        ]);
        if (testerError) throw testerError;
        if (limitError) console.warn('Failed to fetch tester limit:', limitError);
        const testerRows = (testerData || []) as KaraokeTester[];
        setTesters(testerRows);
        setTesterLimit(limitData?.value || '50');
        await loadTesterInsights(testerRows);
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
      } else if (activeTab === 'settings') {
        const { data, error } = await supabase
          .from('telegram_bot_settings')
          .select('*')
          .order('key', { ascending: true });
        if (error) throw error;
        setSettingsList(data || []);
      } else if (activeTab === 'feedback') {
        const { data, error } = await supabase
          .from('feedback')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        setFeedbackItems(data || []);
      } else if (activeTab === 'logs') {
        const { data, error } = await supabase
          .from('telegram_bot_debug_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        setDebugLogs(data || []);
      }
    } catch (err) {
      console.error(`Failed to fetch ${activeTab}:`, err);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (profileId: string, currentRole: string, telegramId: number) => {
    // Block modifying super admins
    if (telegramId === superAdminTgId || telegramId === 8668851942 || telegramId === 2018254756) {
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

  const calculateTesterUntil = (currentUntil?: string | null, days = testerDays) => {
    const now = new Date();
    const base = currentUntil && new Date(currentUntil).getTime() > now.getTime()
      ? new Date(currentUntil)
      : now;
    base.setDate(base.getDate() + days);
    return base.toISOString();
  };

  const refreshTesterData = () => {
    fetchData();
    fetchKpiStats();
  };

  const handleSaveTesterLimit = async () => {
    const numericLimit = Number(testerLimit);
    if (!Number.isFinite(numericLimit) || numericLimit < 1) {
      alert('Tester limit must be a positive number');
      return;
    }

    try {
      const { error } = await supabase
        .from('telegram_bot_settings')
        .upsert({ key: 'karaoke_tester_limit', value: String(Math.floor(numericLimit)) });
      if (error) throw error;
      refreshTesterData();
    } catch (err: any) {
      alert(`Error saving tester limit: ${err.message}`);
    }
  };

  const handleAddTester = async () => {
    const telegramId = Number(newTesterTelegramId.trim());
    if (!Number.isFinite(telegramId) || telegramId <= 0) {
      alert('Enter a valid Telegram ID');
      return;
    }

    const plusUntil = calculateTesterUntil(null, testerDays);

    try {
      const { error: testerError } = await supabase
        .from('karaoke_testers')
        .upsert({
          telegram_id: telegramId,
          username: newTesterUsername.trim() || null,
          source: 'admin',
          status: 'tester_active',
          plus_started_at: new Date().toISOString(),
          plus_until: plusUntil,
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'telegram_id' });
      if (testerError) throw testerError;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, plus_until')
        .eq('telegram_id', telegramId)
        .maybeSingle();

      if (profile) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            role: profile.role === 'admin' ? 'admin' : 'pro',
            plan: 'plus',
            plus_until: calculateTesterUntil(profile.plus_until, testerDays),
            updated_at: new Date().toISOString(),
          })
          .eq('id', profile.id);
        if (profileError) throw profileError;
      }

      setNewTesterTelegramId('');
      setNewTesterUsername('');
      refreshTesterData();
    } catch (err: any) {
      alert(`Error adding tester: ${err.message}`);
    }
  };

  const handleExtendTester = async (tester: KaraokeTester, days = testerDays) => {
    const plusUntil = calculateTesterUntil(tester.plus_until, days);

    try {
      const { error: testerError } = await supabase
        .from('karaoke_testers')
        .update({
          status: 'tester_active',
          plus_until: plusUntil,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tester.id);
      if (testerError) throw testerError;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, plus_until')
        .eq('telegram_id', tester.telegram_id)
        .maybeSingle();

      if (profile) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            role: profile.role === 'admin' ? 'admin' : 'pro',
            plan: 'plus',
            plus_until: calculateTesterUntil(profile.plus_until, days),
            updated_at: new Date().toISOString(),
          })
          .eq('id', profile.id);
        if (profileError) throw profileError;
      }

      refreshTesterData();
    } catch (err: any) {
      alert(`Error extending tester: ${err.message}`);
    }
  };

  const removeTesterAccess = async (tester: KaraokeTester) => {
    try {
      const { error: testerError } = await supabase
        .from('karaoke_testers')
        .update({
          status: 'tester_expired',
          plus_until: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', tester.id);
      if (testerError) throw testerError;

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('telegram_id', tester.telegram_id)
        .maybeSingle();

      if (profile && profile.role !== 'admin') {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            role: 'free',
            plan: 'free',
            plus_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', profile.id);
        if (profileError) throw profileError;
      }

      refreshTesterData();
      return true;
    } catch (err: any) {
      alert(`Error removing tester access: ${err.message}`);
      return false;
    }
  };

  const handleDeactivateTester = async (tester: KaraokeTester) => {
    if (!confirm('Remove tester access for this user?')) return;
    await removeTesterAccess(tester);
  };

  const handleDeleteTester = async (tester: KaraokeTester) => {
    if (!confirm('Delete tester record? Access will also be removed for non-admin profiles.')) return;
    const accessRemoved = await removeTesterAccess(tester);
    if (!accessRemoved) return;
    try {
      const { error } = await supabase
        .from('karaoke_testers')
        .delete()
        .eq('id', tester.id);
      if (error) throw error;
      refreshTesterData();
    } catch (err: any) {
      alert(`Error deleting tester: ${err.message}`);
    }
  };

  const handleSaveSetting = async (key: string, value: string) => {
    try {
      const { error } = await supabase
        .from('telegram_bot_settings')
        .upsert({ key, value });
      if (error) throw error;
      alert(language === 'ru' ? 'Настройка успешно сохранена!' : 'Setting saved successfully!');
      fetchData();
    } catch (err: any) {
      alert(`Error saving setting: ${err.message}`);
    }
  };

  const handleAddSetting = async () => {
    if (!newKey.trim()) return;
    try {
      const { error } = await supabase
        .from('telegram_bot_settings')
        .insert({ key: newKey.trim(), value: newValue.trim() });
      if (error) throw error;
      setNewKey('');
      setNewValue('');
      fetchData();
    } catch (err: any) {
      alert(`Error adding setting: ${err.message}`);
    }
  };

  const handleDeleteSetting = async (key: string) => {
    if (!confirm(language === 'ru' ? `Удалить настройку ${key}?` : `Delete setting ${key}?`)) return;
    try {
      const { error } = await supabase
        .from('telegram_bot_settings')
        .delete()
        .eq('key', key);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert(`Error deleting setting: ${err.message}`);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm(language === 'ru' ? 'Вы уверены, что хотите удалить ВСЕ логи отладки?' : 'Are you sure you want to delete ALL debug logs?')) return;
    try {
      const { error } = await supabase
        .from('telegram_bot_debug_logs')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert(`Error clearing logs: ${err.message}`);
    }
  };

  const handleSettingValueChange = (key: string, value: string) => {
    setSettingsList(prev => prev.map(s => s.key === key ? { ...s, value } : s));
  };

  const handleFeedbackStatusChange = async (id: string, status: string) => {
    try {
      const { error } = await supabase
        .from('feedback')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      setFeedbackItems(prev => prev.map(item => item.id === id ? { ...item, status } : item));
    } catch (err: any) {
      alert(`Error updating feedback: ${err.message}`);
    }
  };

  const handleFeedbackNoteChange = (id: string, adminNote: string) => {
    setFeedbackItems(prev => prev.map(item => item.id === id ? { ...item, admin_note: adminNote } : item));
  };

  const handleFeedbackNoteSave = async (id: string, adminNote: string) => {
    try {
      const { error } = await supabase
        .from('feedback')
        .update({ admin_note: adminNote.trim() || null })
        .eq('id', id);
      if (error) throw error;
    } catch (err: any) {
      alert(`Error saving feedback note: ${err.message}`);
    }
  };

  const handleCopyTechData = async (item: any) => {
    const payload = JSON.stringify(item.technical_data || {}, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
    } catch (err) {
      console.warn('Copy tech data failed:', err);
    }
  };

  const handleDeleteItem = async (table: string, id: string, _extraCheck?: boolean, telegramId?: number) => {
    // Block deleting super admins
    if (table === 'profiles' && (telegramId === superAdminTgId || telegramId === 8668851942 || telegramId === 2018254756)) {
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

  const getFilteredTesters = () => {
    const query = searchQuery.toLowerCase();
    return testers.filter((tester) =>
      tester.telegram_id?.toString().includes(query) ||
      tester.username?.toLowerCase().includes(query) ||
      tester.first_name?.toLowerCase().includes(query) ||
      tester.status?.toLowerCase().includes(query)
    );
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');
  };

  const renderTesterSignal = (active: boolean, label: string, detail?: string | null, tone: 'green' | 'violet' | 'amber' = 'green') => {
    const activeTone = tone === 'violet'
      ? 'bg-violet-500/12 text-violet-600 dark:text-violet-300 border-violet-500/20'
      : tone === 'amber'
        ? 'bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/20'
        : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 border-emerald-500/20';

    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-extrabold ${
        active
          ? activeTone
          : 'border-zinc-200 bg-zinc-100/60 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400'
      }`} title={detail ? formatDateTime(detail) : undefined}>
        <span>{active ? '✓' : '-'}</span>
        <span>{label}</span>
      </span>
    );
  };

  const activeTesterCount = testers.filter((tester) =>
    tester.status === 'tester_active' &&
    tester.plus_until &&
    new Date(tester.plus_until).getTime() > Date.now()
  ).length;
  const numericTesterLimit = Number(testerLimit) || 0;
  const testerSeatsLeft = Math.max(numericTesterLimit - activeTesterCount, 0);

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

  const getFilteredFeedback = () => {
    const query = searchQuery.toLowerCase();
    return feedbackItems.filter((item) =>
      (feedbackFilter === 'all' || item.status === feedbackFilter || item.type === feedbackFilter) &&
      (
        item.message?.toLowerCase().includes(query) ||
        item.contact?.toLowerCase().includes(query) ||
        item.admin_note?.toLowerCase().includes(query) ||
        item.type?.toLowerCase().includes(query) ||
        item.status?.toLowerCase().includes(query) ||
        item.telegram_id?.toString().includes(query)
      )
    );
  };

  const getFeedbackCount = (filter: string) => {
    if (filter === 'all') return feedbackItems.length;
    return feedbackItems.filter(item => item.status === filter || item.type === filter).length;
  };

  const formatKpi = (value: number | null) => value === null ? '-' : value.toString();
  const kpiCards = [
    {
      label: language === 'ru' ? 'Новые пользователи' : 'New users',
      value: kpiStats.usersToday,
      icon: Users,
      accent: 'text-violet-500',
    },
    {
      label: language === 'ru' ? 'Уникальные сегодня' : 'Unique today',
      value: kpiStats.uniqueToday,
      icon: Activity,
      accent: 'text-sky-500',
    },
    {
      label: language === 'ru' ? 'Открытия приложения' : 'App opens',
      value: kpiStats.appOpensToday,
      icon: Eye,
      accent: 'text-emerald-500',
    },
    {
      label: language === 'ru' ? 'Просмотры экранов' : 'Screen views',
      value: kpiStats.screenViewsToday,
      icon: Layers,
      accent: 'text-fuchsia-500',
    },
    {
      label: language === 'ru' ? 'Публичные караоке' : 'Public karaoke opens',
      value: kpiStats.publicOpensToday,
      icon: Music,
      accent: 'text-pink-500',
    },
    {
      label: language === 'ru' ? 'Экспорты видео' : 'Video exports',
      value: kpiStats.exportsCompletedToday,
      icon: Video,
      accent: 'text-orange-500',
    },
    {
      label: language === 'ru' ? 'Публикации' : 'Publications',
      value: kpiStats.publicationsToday,
      icon: UploadCloud,
      accent: 'text-lime-500',
    },
    {
      label: language === 'ru' ? 'Новый фидбэк' : 'New feedback',
      value: kpiStats.feedbackNew,
      icon: MessageSquare,
      accent: 'text-red-500',
    },
  ];

  return (
    <div className={isPage ? 'relative z-10 mx-auto flex w-full max-w-7xl flex-1 p-4 sm:p-6' : 'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4'}>
      {/* Backdrop with premium blur */}
      {!isPage && (
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Modal Container */}
      <div 
        className={`relative flex ${isPage ? 'min-h-[calc(100vh-140px)]' : 'h-[92vh]'} w-full max-w-7xl flex-col overflow-hidden rounded-3xl border shadow-2xl transition-all duration-300 ${
          theme === 'dark' 
            ? 'bg-zinc-950/90 border-zinc-800 text-zinc-100 shadow-zinc-950/50' 
            : 'bg-white border-zinc-200 text-zinc-900 shadow-zinc-300/30'
        }`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-md shadow-red-500/10 animate-pulse">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight">{dict.adminTitle}</h3>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-300 font-bold uppercase tracking-wider">
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

        <div className="grid grid-cols-2 gap-2 border-b border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-900 dark:bg-zinc-950/30 sm:grid-cols-4 xl:grid-cols-8">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className={`rounded-2xl border p-3 transition-all ${
                  theme === 'dark'
                    ? 'border-zinc-700 bg-zinc-900/75'
                    : 'border-zinc-200 bg-white'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Icon size={15} className={card.accent} />
                  {kpiLoading && <RefreshCw size={12} className="animate-spin text-zinc-400" />}
                </div>
                <div className="text-lg font-black tabular-nums">{formatKpi(card.value)}</div>
                <div className="mt-0.5 text-[9px] font-extrabold uppercase leading-tight tracking-wide text-zinc-600 dark:text-zinc-300">
                  {card.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Tabs Navigation */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-900 p-2 gap-1 overflow-x-auto bg-zinc-100/80 dark:bg-zinc-950 shrink-0">
          <button
            onClick={() => { setActiveTab('users'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'users'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <Users size={14} />
            {dict.adminTabUsers}
          </button>

          <button
            onClick={() => { setActiveTab('testers'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'testers'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <UserPlus size={14} />
            {language === 'ru' ? 'Testers' : 'Testers'}
          </button>
          
          <button
            onClick={() => { setActiveTab('songs'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'songs'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <Music size={14} />
            {dict.adminTabSongs}
          </button>

          <button
            onClick={() => { setActiveTab('published'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'published'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <Layers size={14} />
            {dict.adminTabPublished}
          </button>

          <button
            onClick={() => { setActiveTab('stems'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'stems'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <Cpu size={14} />
            {dict.adminTabStems}
          </button>

          <button
            onClick={() => { setActiveTab('feedback'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'feedback'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <MessageSquare size={14} />
            {language === 'ru' ? 'Фидбэк' : 'Feedback'}
            {feedbackItems.some(item => item.status === 'new') && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                {feedbackItems.filter(item => item.status === 'new').length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab('settings'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'settings'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <Settings size={14} />
            {language === 'ru' ? 'Настройки' : 'Settings'}
          </button>

          <button
            onClick={() => { setActiveTab('logs'); setSearchQuery(''); }}
            className={`flex-1 min-w-[118px] py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'logs'
                ? 'bg-white dark:bg-zinc-900 text-red-500 dark:text-red-400 shadow-sm border border-zinc-200/10'
                : 'text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            <FileText size={14} />
            {language === 'ru' ? 'Логи' : 'Logs'}
          </button>
        </div>

        {/* Filter bar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-900 flex gap-3 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-300" size={14} />
            <input 
              type="text"
              placeholder={dict.adminSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100/30 dark:bg-zinc-900/60 text-zinc-800 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-300 focus:outline-none focus:border-red-500/50"
            />
          </div>
          <button 
            onClick={() => {
              fetchData();
              fetchKpiStats();
            }}
            disabled={loading}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300 disabled:opacity-50 transition-all flex items-center gap-1.5 font-semibold text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Table Content Area */}
        <div className="min-h-[360px] flex-1 overflow-y-auto p-4 sm:p-5">
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
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
                        <th className="py-2.5 px-3">{dict.adminUserColName}</th>
                        <th className="py-2.5 px-3">{dict.adminUserColRole}</th>
                        <th className="py-2.5 px-3">{dict.adminUserColTg}</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredProfiles().map((profile) => {
                        const isSuper = profile.telegram_id === superAdminTgId || profile.telegram_id === 8668851942 || profile.telegram_id === 2018254756;
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
                                  {isSuper && <span title="Super Admin"><Shield size={12} className="text-red-500 fill-red-500/10" /></span>}
                                </p>
                                <p className="text-[9px] text-zinc-500 dark:text-zinc-500 font-mono truncate max-w-[120px]" title={profile.id}>
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
                          <td colSpan={4} className="py-10 text-center text-zinc-500 dark:text-zinc-500 font-bold">
                            {dict.searchNoResults}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab Testers */}
              {activeTab === 'testers' && (
                <div className="flex flex-col gap-4">
                  <div className={`grid gap-3 rounded-2xl border p-4 ${
                    theme === 'dark' ? 'border-zinc-700 bg-zinc-900/45' : 'border-zinc-200 bg-zinc-50'
                  } lg:grid-cols-[1.1fr_0.9fr]`}>
                    <div>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <div className={`rounded-2xl border px-4 py-3 ${
                          theme === 'dark' ? 'border-zinc-700 bg-zinc-950/70' : 'border-zinc-200 bg-white'
                        }`}>
                          <div className="text-lg font-black">{activeTesterCount} / {numericTesterLimit || '-'}</div>
                          <div className="text-[9px] font-extrabold uppercase text-zinc-600 dark:text-zinc-300">Active testers</div>
                        </div>
                        <div className={`rounded-2xl border px-4 py-3 ${
                          theme === 'dark' ? 'border-zinc-700 bg-zinc-950/70' : 'border-zinc-200 bg-white'
                        }`}>
                          <div className="text-lg font-black">{testerSeatsLeft}</div>
                          <div className="text-[9px] font-extrabold uppercase text-zinc-600 dark:text-zinc-300">Seats left</div>
                        </div>
                        <div className={`rounded-2xl border px-4 py-3 ${
                          theme === 'dark' ? 'border-zinc-700 bg-zinc-950/70' : 'border-zinc-200 bg-white'
                        }`}>
                          <div className="text-lg font-black">{testers.reduce((sum, tester) => sum + (tester.feedback_count || 0), 0)}</div>
                          <div className="text-[9px] font-extrabold uppercase text-zinc-600 dark:text-zinc-300">Feedback</div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={newTesterTelegramId}
                          onChange={(event) => setNewTesterTelegramId(event.target.value)}
                          placeholder="Telegram ID"
                          className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none focus:border-red-500/50 ${
                            theme === 'dark' ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder-zinc-300' : 'border-zinc-200 bg-white text-zinc-900 placeholder-zinc-400'
                          }`}
                        />
                        <input
                          value={newTesterUsername}
                          onChange={(event) => setNewTesterUsername(event.target.value)}
                          placeholder="Username optional"
                          className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none focus:border-red-500/50 ${
                            theme === 'dark' ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder-zinc-300' : 'border-zinc-200 bg-white text-zinc-900 placeholder-zinc-400'
                          }`}
                        />
                        <input
                          type="number"
                          min={1}
                          value={testerDays}
                          onChange={(event) => setTesterDays(Math.max(1, Number(event.target.value) || 30))}
                          className={`w-24 rounded-xl border px-3 py-2 text-xs outline-none focus:border-red-500/50 ${
                            theme === 'dark' ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder-zinc-300' : 'border-zinc-200 bg-white text-zinc-900 placeholder-zinc-400'
                          }`}
                          title="Days"
                        />
                        <button
                          onClick={handleAddTester}
                          className="rounded-xl bg-red-500 px-4 py-2 text-xs font-extrabold text-white transition-all hover:bg-red-600 active:scale-95"
                        >
                          Add tester
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col justify-end gap-2">
                      <label className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
                        Tester limit
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={1}
                          value={testerLimit}
                          onChange={(event) => setTesterLimit(event.target.value)}
                          className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-xs outline-none focus:border-red-500/50 ${
                            theme === 'dark' ? 'border-zinc-700 bg-zinc-950 text-zinc-100 placeholder-zinc-300' : 'border-zinc-200 bg-white text-zinc-900 placeholder-zinc-400'
                          }`}
                        />
                        <button
                          onClick={handleSaveTesterLimit}
                          className="rounded-xl border border-emerald-500/30 px-4 py-2 text-xs font-extrabold text-emerald-500 transition-all hover:bg-emerald-500/10 active:scale-95"
                        >
                          Save
                        </button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                        Stored in telegram_bot_settings as karaoke_tester_limit.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 uppercase tracking-wider font-bold text-[10px]">
                          <th className="py-2.5 px-3">Tester</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3">Plus until</th>
                          <th className="py-2.5 px-3">Progress</th>
                          <th className="py-2.5 px-3">Feedback</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getFilteredTesters().map((tester) => {
                          const isActive = tester.status === 'tester_active' && tester.plus_until && new Date(tester.plus_until).getTime() > Date.now();
                          const insight = testerInsights[tester.telegram_id] || emptyTesterInsight();
                          const feedbackCount = Math.max(tester.feedback_count || 0, insight.feedbackCount || 0);
                          const statusClass = isActive
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : tester.status === 'tester_waitlist'
                              ? 'bg-amber-500/10 text-amber-500'
                              : 'bg-zinc-500/10 text-zinc-500';

                          return (
                            <tr key={tester.id} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-100/20 dark:hover:bg-zinc-900/35">
                              <td className="py-3 px-3">
                                <p className="font-bold text-zinc-800 dark:text-zinc-200">
                                  {tester.username ? `@${tester.username}` : tester.first_name || 'No username'}
                                </p>
                                <p className="font-mono text-[10px] text-zinc-600 dark:text-zinc-300">TG: {tester.telegram_id}</p>
                                <p className="text-[9px] text-zinc-600 dark:text-zinc-400">Source: {tester.source || '-'}</p>
                              </td>
                              <td className="py-3 px-3">
                                <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase ${statusClass}`}>
                                  {tester.status}
                                </span>
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1 font-mono text-[10px] text-zinc-600 dark:text-zinc-300">
                                  <Clock size={12} />
                                  {formatDateTime(tester.plus_until)}
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                <div className="flex max-w-[310px] flex-wrap gap-1.5">
                                  {renderTesterSignal(insight.openedSite, 'Site', insight.lastSeenAt, 'violet')}
                                  {renderTesterSignal(insight.importedAudio, 'Audio', insight.lastImportAt, 'green')}
                                  {renderTesterSignal(insight.startedExport || insight.completedExport, insight.completedExport ? 'Export done' : 'Export', insight.lastExportAt, insight.completedExport ? 'green' : 'amber')}
                                  {renderTesterSignal(insight.sentFeedback || feedbackCount > 0, 'Feedback', null, 'violet')}
                                </div>
                              </td>
                              <td className="py-3 px-3 font-mono font-bold text-violet-500">
                                {feedbackCount}
                              </td>
                              <td className="py-3 px-3 text-right">
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleExtendTester(tester)}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                                  >
                                    +{testerDays}d
                                  </button>
                                  <button
                                    onClick={() => handleDeactivateTester(tester)}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                                  >
                                    <UserX size={12} className="inline" /> Off
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTester(tester)}
                                    className="p-1.5 text-zinc-500 dark:text-zinc-300 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {getFilteredTesters().length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-10 text-center text-zinc-500 dark:text-zinc-500 font-bold">
                              {dict.searchNoResults}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab Songs */}
              {activeTab === 'songs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
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
                          <td colSpan={4} className="py-10 text-center text-zinc-500 dark:text-zinc-500 font-bold">
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
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
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
                            <p className="font-semibold text-zinc-700 dark:text-zinc-300">{pub.profiles?.username || 'Guest'}</p>
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
                          <td colSpan={4} className="py-10 text-center text-zinc-500 dark:text-zinc-500 font-bold">
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
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
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
                            <td className="py-3 px-3 text-zinc-500 dark:text-zinc-500 font-mono">
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
                          <td colSpan={4} className="py-10 text-center text-zinc-500 dark:text-zinc-500 font-bold">
                            {dict.searchNoResults}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab Feedback */}
              {activeTab === 'feedback' && (
                <div className="flex flex-col gap-3">
                  <div className={`rounded-2xl border p-3 ${
                    theme === 'dark'
                      ? 'border-zinc-800 bg-zinc-900/25'
                      : 'border-zinc-200 bg-zinc-50'
                  }`}>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 'all', label: language === 'ru' ? 'Все' : 'All' },
                        { value: 'new', label: language === 'ru' ? 'Новые' : 'New' },
                        { value: 'in_progress', label: language === 'ru' ? 'В работе' : 'In progress' },
                        { value: 'done', label: language === 'ru' ? 'Готово' : 'Done' },
                        { value: 'bug', label: language === 'ru' ? 'Баги' : 'Bugs' },
                        { value: 'idea', label: language === 'ru' ? 'Идеи' : 'Ideas' },
                      ].map((filter) => (
                        <button
                          key={filter.value}
                          onClick={() => setFeedbackFilter(filter.value)}
                          className={`rounded-xl border px-3 py-2 text-[10px] font-extrabold transition-all ${
                            feedbackFilter === filter.value
                              ? 'border-red-500 bg-red-500 text-white shadow-sm shadow-red-500/20'
                              : theme === 'dark'
                                ? 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-100'
                                : 'border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900'
                          }`}
                        >
                          {filter.label}
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 ${
                            feedbackFilter === filter.value
                              ? 'bg-white/20 text-white'
                              : 'bg-zinc-500/10 text-zinc-500'
                          }`}>
                            {getFeedbackCount(filter.value)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {getFilteredFeedback().map((item) => {
                    const isExpanded = expandedFeedbackId === item.id;
                    const screenshots = Array.isArray(item.screenshots)
                      ? item.screenshots.filter((screenshot: any) => typeof screenshot?.dataUrl === 'string')
                      : [];
                    const statusClass =
                      item.status === 'done'
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : item.status === 'in_progress'
                          ? 'bg-violet-500/10 text-violet-500'
                          : item.status === 'ignored'
                            ? 'bg-zinc-500/10 text-zinc-500'
                            : 'bg-amber-500/10 text-amber-500';

                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 transition-all ${
                          theme === 'dark'
                            ? 'bg-zinc-900/25 border-zinc-800'
                            : 'bg-white border-zinc-200'
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[9px] font-extrabold uppercase text-sky-500">
                                {item.type || 'other'}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase ${statusClass}`}>
                                {item.status || 'new'}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">
                                {new Date(item.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}
                              </span>
                            </div>

                            <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                              {item.message}
                            </p>

                            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                              {item.contact && <span>Contact: {item.contact}</span>}
                              {item.telegram_id && <span>TG: {item.telegram_id}</span>}
                              {item.user_id && <span className="font-mono">User: {item.user_id}</span>}
                            </div>

                            {screenshots.length > 0 && (
                              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {screenshots.map((screenshot: any, index: number) => (
                                  <a
                                    key={`${item.id}-screenshot-${index}`}
                                    href={screenshot.dataUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="group overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 transition-transform hover:scale-[1.02] dark:border-zinc-800 dark:bg-zinc-950"
                                    title={screenshot.name || (language === 'ru' ? 'Скриншот' : 'Screenshot')}
                                  >
                                    <img
                                      src={screenshot.dataUrl}
                                      alt={screenshot.name || (language === 'ru' ? 'Скриншот фидбэка' : 'Feedback screenshot')}
                                      className="h-24 w-full object-cover"
                                    />
                                  </a>
                                ))}
                              </div>
                            )}

                            <div className="mt-3">
                              <label className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-400">
                                {language === 'ru' ? 'Внутренняя заметка' : 'Internal note'}
                              </label>
                              <textarea
                                value={item.admin_note || ''}
                                onChange={(event) => handleFeedbackNoteChange(item.id, event.target.value)}
                                onBlur={(event) => handleFeedbackNoteSave(item.id, event.target.value)}
                                placeholder={language === 'ru' ? 'Например: проверить на Mac, дубликат, поправлено...' : 'Example: test on Mac, duplicate, fixed...'}
                                rows={2}
                                className={`mt-1 w-full resize-none rounded-xl border px-3 py-2 text-xs outline-none transition-colors focus:border-red-500/50 ${
                                  theme === 'dark'
                                    ? 'border-zinc-800 bg-zinc-950/60 text-zinc-200 placeholder-zinc-600'
                                    : 'border-zinc-200 bg-zinc-50 text-zinc-800 placeholder-zinc-400'
                                }`}
                              />
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col gap-2 sm:w-36">
                            <select
                              value={item.status || 'new'}
                              onChange={(event) => handleFeedbackStatusChange(item.id, event.target.value)}
                              className={`rounded-xl border px-2 py-2 text-xs font-bold outline-none ${
                                theme === 'dark'
                                  ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
                                  : 'bg-white border-zinc-200 text-zinc-900'
                              }`}
                            >
                              <option value="new">new</option>
                              <option value="in_progress">in progress</option>
                              <option value="done">done</option>
                              <option value="ignored">ignored</option>
                            </select>
                            <button
                              onClick={() => setExpandedFeedbackId(isExpanded ? null : item.id)}
                              className="rounded-xl border border-zinc-200 px-2 py-2 text-[10px] font-bold text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                            >
                              {isExpanded ? (language === 'ru' ? 'Скрыть техданные' : 'Hide tech data') : (language === 'ru' ? 'Техданные' : 'Tech data')}
                            </button>
                            <button
                              onClick={() => handleCopyTechData(item)}
                              className="flex items-center justify-center gap-1 rounded-xl border border-zinc-200 px-2 py-2 text-[10px] font-bold text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                            >
                              <Clipboard size={12} />
                              {language === 'ru' ? 'Копировать' : 'Copy'}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-zinc-900 bg-zinc-950 p-3 text-[10px] leading-normal text-zinc-300">
                            {JSON.stringify(item.technical_data || {}, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })}

                  {getFilteredFeedback().length === 0 && (
                    <div className="py-16 text-center text-zinc-500 dark:text-zinc-500 font-bold border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/10">
                      {language === 'ru' ? 'Фидбэка пока нет' : 'No feedback yet'}
                    </div>
                  )}
                </div>
              )}

              {/* Tab Settings */}
              {activeTab === 'settings' && (
                <div className="flex flex-col gap-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-bold text-[10px]">
                          <th className="py-2.5 px-3">{language === 'ru' ? 'Ключ' : 'Key'}</th>
                          <th className="py-2.5 px-3">{language === 'ru' ? 'Значение' : 'Value'}</th>
                          <th className="py-2.5 px-3 text-right">{language === 'ru' ? 'Действия' : 'Actions'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {settingsList.map((setting) => (
                          <tr key={setting.key} className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-100/20 dark:hover:bg-zinc-900/20">
                            <td className="py-3 px-3 font-mono font-bold text-zinc-800 dark:text-zinc-300">
                              {setting.key}
                            </td>
                            <td className="py-3 px-3">
                              <input
                                type="text"
                                value={setting.value}
                                onChange={(e) => handleSettingValueChange(setting.key, e.target.value)}
                                className={`w-full px-3 py-1.5 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all ${
                                  theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
                                }`}
                              />
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleSaveSetting(setting.key, setting.value)}
                                  className="px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                                >
                                  {language === 'ru' ? 'Сохранить' : 'Save'}
                                </button>
                                <button
                                  onClick={() => handleDeleteSetting(setting.key)}
                                  className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {settingsList.length === 0 && (
                          <tr>
                            <td colSpan={3} className="py-8 text-center text-zinc-500 dark:text-zinc-500 font-bold">
                              {language === 'ru' ? 'Настройки отсутствуют' : 'No settings found'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Setting Row */}
                  <div className={`p-4 rounded-2xl border ${
                    theme === 'dark' ? 'bg-zinc-900/30 border-zinc-900' : 'bg-zinc-50 border-zinc-200'
                  }`}>
                    <h5 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500 mb-3">
                      {language === 'ru' ? 'Добавить новую настройку' : 'Add New Setting'}
                    </h5>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        placeholder={language === 'ru' ? 'Ключ (например, storage_channel_id)' : 'Key...'}
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all ${
                          theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
                        }`}
                      />
                      <input
                        type="text"
                        placeholder={language === 'ru' ? 'Значение...' : 'Value...'}
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs border focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all ${
                          theme === 'dark' ? 'bg-zinc-950 border-zinc-800 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'
                        }`}
                      />
                      <button
                        onClick={handleAddSetting}
                        className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 shrink-0 cursor-pointer"
                      >
                        {language === 'ru' ? 'Добавить' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab Logs */}
              {activeTab === 'logs' && (
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center bg-zinc-100/30 dark:bg-zinc-900/30 p-3 rounded-2xl border border-zinc-200/20 dark:border-zinc-800/40">
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-500 font-bold uppercase tracking-wider">
                      {language === 'ru' ? 'Последние 50 входящих логов отладки' : 'Last 50 debug webhook logs'}
                    </span>
                    {debugLogs.length > 0 && (
                      <button
                        onClick={handleClearLogs}
                        className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-500 rounded-xl text-[10px] font-bold transition-all active:scale-95 cursor-pointer"
                      >
                        {language === 'ru' ? 'Очистить логи' : 'Clear Logs'}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 max-h-[64vh] overflow-y-auto pr-1">
                    {debugLogs.map((log) => {
                      const isExpanded = expandedLogId === log.id;
                      return (
                        <div
                          key={log.id}
                          className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${
                            theme === 'dark'
                              ? 'bg-zinc-900/20 border-zinc-800/80 hover:border-zinc-800'
                              : 'bg-white border-zinc-200 hover:border-zinc-300'
                          }`}
                        >
                          <div
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="flex justify-between items-center cursor-pointer select-none text-[11px]"
                          >
                            <span className="font-mono text-zinc-500 dark:text-zinc-500 font-bold">
                              {new Date(log.created_at).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US')}
                            </span>
                            <span className="text-[9px] font-bold text-violet-500 hover:underline">
                              {isExpanded ? (language === 'ru' ? 'Свернуть' : 'Collapse') : (language === 'ru' ? 'Развернуть' : 'Expand')}
                            </span>
                          </div>

                          {isExpanded && (
                            <pre className="text-[10px] font-mono p-3 bg-zinc-950 text-zinc-300 rounded-lg overflow-x-auto border border-zinc-900 leading-normal max-h-60 overflow-y-auto">
                              {JSON.stringify(log.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                    {debugLogs.length === 0 && (
                      <div className="py-16 text-center text-zinc-500 dark:text-zinc-500 font-bold border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/10">
                        {language === 'ru' ? 'Логи отладки вебхуков отсутствуют' : 'No webhook debug logs found'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer with Warning / Alert */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-900 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/20 shrink-0">
          <div className="flex items-center gap-2 text-red-500 dark:text-red-400 text-[10px] font-semibold">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{dict.adminSuperAdminAlert}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-800 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] cursor-pointer"
          >
            {dict.adminClose}
          </button>
        </div>
      </div>
    </div>
  );
};
