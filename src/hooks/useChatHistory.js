import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'gdh_grandmaster_chat_v1';

export const INITIAL_WELCOME_MESSAGE = {
  id: 'welcome-msg',
  role: 'assistant',
  content: `Greetings! I am the Grandmaster AI, your strategic digital mentor and intelligent architect. 

I can assist you with:
• **Software & Web Development:** Architecture, React, Python, API design, debugging.
• **Digital Business & Freelancing:** Pricing strategy, product ideation, client pitching.
• **Educational Guidance:** Coding roadmaps for young and aspiring creators.
• **Grandmaster Ecosystem:** Platform utilities, tools, and technical workflows.

*Aap mujh se English ya Roman Urdu dono mein baat kar saktay hain. How can I assist your venture today?*`,
  timestamp: new Date().toISOString()
};

export function useChatHistory() {
  const [messages, setMessages] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [INITIAL_WELCOME_MESSAGE];
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      return [INITIAL_WELCOME_MESSAGE];
    } catch (e) {
      console.warn('[useChatHistory] Corrupted localStorage detected. Resetting to default.', e);
      return [INITIAL_WELCOME_MESSAGE];
    }
  });

  const [storageError, setStorageError] = useState(null);

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      setStorageError(null);
    } catch (e) {
      console.error('[useChatHistory] Failed to write messages to localStorage:', e);
      setStorageError('Browser storage limit exceeded or inaccessible.');
    }
  }, [messages]);

  const addMessage = useCallback((msg) => {
    setMessages(prev => [
      ...prev,
      {
        id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || new Date().toISOString(),
        error: Boolean(msg.error)
      }
    ]);
  }, []);

  const startNewConversation = useCallback(() => {
    const freshMessage = {
      ...INITIAL_WELCOME_MESSAGE,
      timestamp: new Date().toISOString()
    };
    setMessages([freshMessage]);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([freshMessage]));
    } catch (e) {
      // Safe fallback
    }
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Safe fallback
    }
  }, []);

  return {
    messages,
    addMessage,
    startNewConversation,
    clearConversation,
    storageError,
    storageNotice: 'Conversation history is stored locally in this browser. Cross-device sync and persistent database memory will be integrated in future ecosystem milestones.'
  };
}
