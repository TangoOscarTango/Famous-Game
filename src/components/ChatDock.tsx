import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface ChannelInfo {
  slug: string;
  displayName: string;
  sortOrder: number;
}

interface ChatMessage {
  id: string;
  channel_slug: string;
  user_id: string;
  display_name: string;
  message: string;
  created_at: string;
}

interface ChatStateResponse {
  channels: ChannelInfo[];
  userState: {
    enabledChannels: string[];
    activeChannel: string;
    mutedChannels: string[];
    dockCollapsed: boolean;
  };
}

const MAX_HISTORY = 50;
const isNearBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

const ChatDock: React.FC = () => {
  const { user } = useAuth();
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [enabledChannels, setEnabledChannels] = useState<string[]>(['global', 'trade']);
  const [activeChannel, setActiveChannel] = useState<string>('global');
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, ChatMessage[]>>({});
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [statusText, setStatusText] = useState<string>('');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [canPayBypass, setCanPayBypass] = useState(false);
  const messagePaneRef = useRef<HTMLDivElement>(null);

  const sortedEnabledChannels = useMemo(
    () =>
      channels
        .filter((c) => enabledChannels.includes(c.slug))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [channels, enabledChannels],
  );

  const saveState = async (next: Partial<ChatStateResponse['userState']>) => {
    if (!user) return;
    await supabase.rpc('chat_save_state', {
      p_user_id: user.id,
      p_enabled_channels: next.enabledChannels ?? enabledChannels,
      p_active_channel: next.activeChannel ?? activeChannel,
      p_muted_channels: [],
      p_dock_collapsed: next.dockCollapsed ?? collapsed,
    });
  };

  const fetchHistory = async (slug: string) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('id, channel_slug, user_id, display_name, message, created_at')
      .eq('channel_slug', slug)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY);

    if (!data) return;
    const sorted = [...data].reverse() as ChatMessage[];
    setMessagesByChannel((prev) => ({ ...prev, [slug]: sorted }));
  };

  const loadInitial = async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc('chat_get_state', { p_user_id: user.id });
    if (error || !data) return;

    const state = data as ChatStateResponse;
    setChannels(state.channels || []);
    setEnabledChannels(state.userState.enabledChannels?.length ? state.userState.enabledChannels : ['global', 'trade']);
    setActiveChannel(state.userState.activeChannel || 'global');
    setCollapsed(Boolean(state.userState.dockCollapsed));

    const initialChannels = (state.userState.enabledChannels?.length ? state.userState.enabledChannels : ['global', 'trade']).slice(0, 4);
    await Promise.all(initialChannels.map((slug) => fetchHistory(slug)));
  };

  useEffect(() => {
    if (!user) return;
    void loadInitial();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('chat_dock_messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          if (!enabledChannels.includes(incoming.channel_slug)) return;

          setMessagesByChannel((prev) => {
            const existing = prev[incoming.channel_slug] ?? [];
            if (existing.some((m) => m.id === incoming.id)) return prev;
            const next = [...existing, incoming].slice(-MAX_HISTORY);
            return { ...prev, [incoming.channel_slug]: next };
          });

          const pane = messagePaneRef.current;
          const viewingActive = incoming.channel_slug === activeChannel && !collapsed;
          const autoScroll = viewingActive && pane && isNearBottom(pane);

          if (viewingActive) {
            if (autoScroll) {
              requestAnimationFrame(() => {
                if (!messagePaneRef.current) return;
                messagePaneRef.current.scrollTop = messagePaneRef.current.scrollHeight;
                setShowJumpToLatest(false);
              });
            } else {
              setShowJumpToLatest(true);
            }
          } else {
            setUnreadByChannel((prev) => ({
              ...prev,
              [incoming.channel_slug]: (prev[incoming.channel_slug] || 0) + 1,
            }));
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setStatusText('');
        if (status === 'CHANNEL_ERROR') setStatusText('Realtime reconnecting...');
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, enabledChannels.join(','), activeChannel, collapsed]);

  useEffect(() => {
    setUnreadByChannel((prev) => ({ ...prev, [activeChannel]: 0 }));
    requestAnimationFrame(() => {
      if (!messagePaneRef.current) return;
      messagePaneRef.current.scrollTop = messagePaneRef.current.scrollHeight;
      setShowJumpToLatest(false);
    });
  }, [activeChannel, collapsed]);

  const sendMessage = async (payBypass = false) => {
    if (!user || sending) return;
    const text = input.trim();
    if (!text) return;
    setSending(true);
    setStatusText('');

    const { error } = await supabase.rpc('chat_send_message', {
      p_user_id: user.id,
      p_channel_slug: activeChannel,
      p_body: text,
      p_pay_bypass_cooldown: payBypass,
    });

    if (error) {
      const msg = error.message || 'Send failed.';
      setStatusText(msg);
      setCanPayBypass(msg.toLowerCase().includes('cooldown active'));
      setSending(false);
      return;
    }

    setInput('');
    setCanPayBypass(false);
    setSending(false);
  };

  const toggleChannelEnabled = async (slug: string) => {
    const next = enabledChannels.includes(slug)
      ? enabledChannels.filter((s) => s !== slug)
      : [...enabledChannels, slug];
    if (next.length === 0) return;
    setEnabledChannels(next);
    if (!next.includes(activeChannel)) setActiveChannel(next[0]);
    await saveState({ enabledChannels: next, activeChannel: next.includes(activeChannel) ? activeChannel : next[0] });
    if (!messagesByChannel[slug]) await fetchHistory(slug);
  };

  const onCollapseToggle = async () => {
    const next = !collapsed;
    setCollapsed(next);
    await saveState({ dockCollapsed: next });
  };

  if (!user) return null;

  const activeMessages = messagesByChannel[activeChannel] ?? [];

  return (
    <div className="fixed bottom-3 right-3 z-50 hidden md:block">
      <div className={`rounded-lg border border-gray-700 bg-gray-900/95 shadow-2xl backdrop-blur ${collapsed ? 'w-64' : 'w-[420px]'}`}>
        <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
          <div className="flex items-center gap-2">
            <button onClick={onCollapseToggle} className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700">
              {collapsed ? 'Open Chat' : 'Minimize'}
            </button>
            {!collapsed &&
              sortedEnabledChannels.map((channel) => (
                <button
                  key={channel.slug}
                  onClick={() => {
                    setActiveChannel(channel.slug);
                    void saveState({ activeChannel: channel.slug });
                  }}
                  className={`rounded px-2 py-1 text-xs ${activeChannel === channel.slug ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'}`}
                >
                  {channel.displayName}
                  {(unreadByChannel[channel.slug] || 0) > 0 ? (
                    <span className="ml-1 rounded bg-red-600 px-1 text-[10px]">{unreadByChannel[channel.slug]}</span>
                  ) : null}
                </button>
              ))}
          </div>
          <button onClick={() => setSettingsOpen((s) => !s)} className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700">
            ⚙
          </button>
        </div>

        {settingsOpen && !collapsed && (
          <div className="border-b border-gray-700 px-3 py-2 text-xs text-gray-300">
            <p className="mb-1 text-gray-400">Channels</p>
            <div className="flex gap-2">
              {channels.map((channel) => (
                <label key={channel.slug} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={enabledChannels.includes(channel.slug)}
                    onChange={() => void toggleChannelEnabled(channel.slug)}
                  />
                  {channel.displayName}
                </label>
              ))}
            </div>
          </div>
        )}

        {!collapsed && (
          <>
            <div
              ref={messagePaneRef}
              className="h-72 overflow-y-auto px-3 py-2 text-sm"
              onScroll={() => {
                const pane = messagePaneRef.current;
                if (!pane) return;
                if (isNearBottom(pane)) setShowJumpToLatest(false);
              }}
            >
              {activeMessages.map((msg) => (
                <div key={msg.id} className="mb-2 rounded border border-gray-800 bg-gray-950/70 px-2 py-1">
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="font-semibold text-cyan-300">{msg.display_name}</span>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-gray-100">{msg.message}</p>
                </div>
              ))}
            </div>

            {showJumpToLatest && (
              <div className="px-3 pb-1">
                <button
                  onClick={() => {
                    if (!messagePaneRef.current) return;
                    messagePaneRef.current.scrollTop = messagePaneRef.current.scrollHeight;
                    setShowJumpToLatest(false);
                  }}
                  className="text-xs text-cyan-300 hover:text-cyan-200"
                >
                  New messages - jump to latest
                </button>
              </div>
            )}

            <div className="border-t border-gray-700 px-3 py-2">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  maxLength={280}
                  placeholder={`Message #${activeChannel}`}
                  className="flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-gray-100 outline-none focus:border-cyan-600"
                />
                <button
                  onClick={() => void sendMessage()}
                  disabled={sending || !input.trim()}
                  className="rounded bg-cyan-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  Send
                </button>
                {canPayBypass && (
                  <button
                    onClick={() => void sendMessage(true)}
                    disabled={sending || !input.trim()}
                    className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Post now (1 FP)
                  </button>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                <span>{input.trim().length}/280</span>
                <span>{statusText}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatDock;
