import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useWallet } from '@/contexts/WalletContext';
import { supabase } from '@/lib/supabase';

interface Message {
  id: string;
  user_id: string;
  display_name: string;
  message: string;
  created_at: string;
}

const COOLDOWN_MS = 10_000;
const COOLDOWN_BYPASS_COST_FP = 1;
const MAX_MESSAGE_LENGTH = 280;

const Chat: React.FC = () => {
  const { user, updateUserStats } = useAuth();
  const { refreshWalletState } = useWallet();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [onlineCount, setOnlineCount] = useState(1);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownNow, setCooldownNow] = useState(Date.now());
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchMessages();

    const channel = supabase
      .channel('chat_messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) => (prev.some((msg) => msg.id === incoming.id) ? prev : [...prev, incoming]));
        },
      )
      .subscribe();

    setOnlineCount(Math.floor(Math.random() * 15) + 1);

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const timer = window.setInterval(() => setCooldownNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) {
      setCooldownUntil(0);
      return;
    }

    let latestOwnMessageMs = 0;
    for (const msg of messages) {
      if (msg.user_id !== user.id) continue;
      const createdAt = new Date(msg.created_at).getTime();
      if (!Number.isNaN(createdAt) && createdAt > latestOwnMessageMs) {
        latestOwnMessageMs = createdAt;
      }
    }

    if (latestOwnMessageMs > 0) {
      setCooldownUntil(latestOwnMessageMs + COOLDOWN_MS);
    }
  }, [messages, user]);

  const cooldownRemainingMs = Math.max(0, cooldownUntil - cooldownNow);
  const cooldownRemainingSeconds = Math.ceil(cooldownRemainingMs / 1000);

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;
      if (data) setMessages(data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    if (cooldownRemainingMs > 0) {
      setSendError(`Cooldown active: wait ${cooldownRemainingSeconds}s or pay ${COOLDOWN_BYPASS_COST_FP} FP.`);
      return;
    }

    await sendMessageRequest(false);
  };

  const sendMessageOnCooldown = async () => {
    if (!newMessage.trim() || !user) return;
    await sendMessageRequest(true);
  };

  const sendMessageRequest = async (payToBypassCooldown: boolean) => {
    if (!user) return;

    setSending(true);
    setSendError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const { data, error } = await supabase.functions.invoke('chat-send', {
        body: {
          requestId: crypto.randomUUID(),
          message: newMessage.trim(),
          payToBypassCooldown,
        },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      if (error) {
        let detailedMessage = error.message || 'Unable to send message.';
        let cooldownRemainingMsFromError = 0;

        if (error.context && typeof error.context.text === 'function') {
          const raw = await error.context.text();
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              detailedMessage = parsed?.error || detailedMessage;
              cooldownRemainingMsFromError = Number(parsed?.cooldownRemainingMs || 0);
            } catch {
              detailedMessage = raw;
            }
          }
        }

        if (cooldownRemainingMsFromError > 0) {
          setCooldownUntil(Date.now() + cooldownRemainingMsFromError);
        }

        throw new Error(detailedMessage);
      }

      if (data?.record) {
        const incoming = data.record as Message;
        setMessages((prev) => (prev.some((msg) => msg.id === incoming.id) ? prev : [...prev, incoming]));
      }

      if (typeof data?.nextPostAt === 'string') {
        const nextPostMs = new Date(data.nextPostAt).getTime();
        if (!Number.isNaN(nextPostMs)) {
          setCooldownUntil(nextPostMs);
        }
      } else {
        setCooldownUntil(Date.now() + COOLDOWN_MS);
      }

      if (Number(data?.chargedSats || 0) > 0) {
        await refreshWalletState();
      }

      await updateUserStats({ messagesSent: (user.messagesSent || 0) + 1 });

      setNewMessage('');
      inputRef.current?.focus();
    } catch (error: any) {
      setSendError(error?.message || 'Unable to send message.');
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOwnMessage = (msg: Message) => user && msg.user_id === user.id;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] sm:h-[calc(100vh-6rem)]">
      <div className="flex-shrink-0 rounded-t-2xl bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-cyan-500/10 border border-gray-700/50 border-b-0 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Global Chat</h1>
              <p className="text-xs text-gray-400">Chat with everyone in real-time</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-medium">{onlineCount} online</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-800/30 border-x border-gray-700/50 p-4 space-y-4">
        {messages.length > 0 ? (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${isOwnMessage(msg) ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex items-end gap-2 max-w-[85%] sm:max-w-[70%] ${isOwnMessage(msg) ? 'flex-row-reverse' : ''}`}>
                <div
                  className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${
                    isOwnMessage(msg)
                      ? 'bg-gradient-to-br from-cyan-500 to-blue-600'
                      : 'bg-gradient-to-br from-purple-500 to-pink-600'
                  }`}
                >
                  {(msg.display_name || 'A').charAt(0).toUpperCase()}
                </div>

                <div
                  className={`rounded-2xl px-4 py-2.5 ${
                    isOwnMessage(msg)
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 rounded-br-md'
                      : 'bg-gray-700/70 rounded-bl-md'
                  }`}
                >
                  {!isOwnMessage(msg) && (
                    <p className="text-xs text-purple-400 font-medium mb-1">{msg.display_name || 'Anonymous'}</p>
                  )}
                  <p className="text-white text-sm break-words">{msg.message}</p>
                  <p className={`text-xs mt-1 ${isOwnMessage(msg) ? 'text-cyan-200/70' : 'text-gray-500'}`}>
                    {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-gray-700/50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-gray-400 font-medium">No messages yet</p>
            <p className="text-gray-500 text-sm mt-1">Be the first to say hello!</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex-shrink-0 rounded-b-2xl bg-gray-800/50 border border-gray-700/50 border-t-0 p-4">
        {user ? (
          <form onSubmit={sendMessage} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Type a message..."
                className="flex-1 px-4 py-3 bg-gray-700/50 border border-gray-600/50 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim() || cooldownRemainingMs > 0}
                className="p-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                title={cooldownRemainingMs > 0 ? `Cooldown: ${cooldownRemainingSeconds}s` : 'Send'}
              >
                {sending ? (
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">{newMessage.trim().length}/{MAX_MESSAGE_LENGTH}</span>
              {cooldownRemainingMs > 0 ? (
                <span className="text-orange-300">Next free post in {cooldownRemainingSeconds}s</span>
              ) : (
                <span className="text-green-300">Ready to post</span>
              )}
            </div>

            {cooldownRemainingMs > 0 && (
              <button
                type="button"
                onClick={sendMessageOnCooldown}
                disabled={sending || !newMessage.trim()}
                className="self-start px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500/20 text-orange-300 border border-orange-500/40 hover:bg-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Post now for {COOLDOWN_BYPASS_COST_FP} FP
              </button>
            )}

            {sendError && <p className="text-xs text-red-300">{sendError}</p>}
          </form>
        ) : (
          <div className="text-center py-2">
            <p className="text-gray-400 text-sm">Sign in to join the conversation</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
