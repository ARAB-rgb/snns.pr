import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Phone, Video, Send, Mic, Image, Languages, Play, Pause, CheckCheck, Loader2, Sparkles } from 'lucide-react';
import { User, Message } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../types/i18n';
import { sounds } from '../services/audioSynthesizer';

interface ChatDetailProps {
  currentUserId: string;
  participant: User;
  messages: Message[];
  onBack: () => void;
  onSendMessage: (text: string, type?: 'text' | 'audio' | 'image', mediaUrl?: string) => void;
  onStartCall: (participant: User, type: 'audio' | 'video') => void;
}

export const ChatDetail: React.FC<ChatDetailProps> = ({
  currentUserId,
  participant,
  messages,
  onBack,
  onSendMessage,
  onStartCall
}) => {
  const { currentLang, direction, t } = useLanguage();
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, boolean>>({});
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Voice recording logic using Web MediaRecorder API
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        onSendMessage('Voice Note', 'audio', audioUrl);
        sounds.playMessageSentSound();
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Mic access error for voice note:', err);
      // Fallback voice note if mic denied
      onSendMessage('Voice Note (0:04)', 'audio', '#');
      sounds.playMessageSentSound();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim(), 'text');
    setInputText('');
    sounds.playMessageSentSound();
  };

  const toggleTranslation = (msgId: string) => {
    setTranslatedMessages((prev) => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onSendMessage('Photo', 'image', event.target.result as string);
          sounds.playMessageSentSound();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const langInfo = SUPPORTED_LANGUAGES[participant.language];

  return (
    <div className="flex-1 flex flex-col bg-slate-950 h-full overflow-hidden relative">
      {/* Top Header */}
      <div className="px-3 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
            title="Back"
          >
            <ArrowLeft className={`w-4 h-4 ${direction === 'rtl' ? 'rotate-180' : ''}`} />
          </button>

          <div className="relative shrink-0">
            <img
              src={participant.avatar}
              alt={participant.name}
              className="w-10 h-10 rounded-full object-cover border border-slate-700"
            />
            {participant.isOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full" />
            )}
          </div>

          <div className="min-w-0">
            <h2 className="text-xs font-bold text-slate-100 truncate flex items-center gap-1.5">
              <span>{participant.name}</span>
              <span className="text-[10px] opacity-90">{langInfo.flag}</span>
            </h2>
            <p className="text-[10px] text-emerald-400 font-medium">
              {participant.isOnline ? t('online') : participant.lastSeen}
            </p>
          </div>
        </div>

        {/* Action Call Icons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onStartCall(participant, 'audio')}
            className="p-2.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 transition-all cursor-pointer"
            title={t('audioCall')}
          >
            <Phone className="w-4 h-4" />
          </button>

          <button
            onClick={() => onStartCall(participant, 'video')}
            className="p-2.5 rounded-xl bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 transition-all cursor-pointer"
            title={t('videoCall')}
          >
            <Video className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
        {messages.map((msg) => {
          const isMe = msg.senderId === currentUserId;
          const isTranslated = translatedMessages[msg.id];

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} transition-all`}
            >
              <div
                className={`max-w-[82%] sm:max-w-[70%] p-3 rounded-2xl shadow-md text-xs relative ${
                  isMe
                    ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-br-none'
                    : 'bg-slate-850 bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/80'
                }`}
              >
                {/* Media Image */}
                {msg.type === 'image' && msg.mediaUrl && (
                  <img
                    src={msg.mediaUrl}
                    alt="attachment"
                    className="max-w-full max-h-48 rounded-xl object-cover mb-2 border border-black/20"
                  />
                )}

                {/* Voice Note Audio */}
                {msg.type === 'audio' && (
                  <div className="flex items-center gap-2.5 py-1">
                    <button
                      onClick={() => setPlayingAudioId(playingAudioId === msg.id ? null : msg.id)}
                      className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white cursor-pointer"
                    >
                      {playingAudioId === msg.id ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5 ml-0.5" />
                      )}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-0.5 h-4">
                        {[40, 70, 30, 90, 50, 80, 40, 60, 30].map((h, i) => (
                          <div
                            key={i}
                            style={{ height: `${h}%` }}
                            className={`w-1 rounded-full ${
                              playingAudioId === msg.id ? 'bg-cyan-300 animate-pulse' : 'bg-white/50'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-[9px] opacity-80 mt-0.5 block">Voice Message</span>
                    </div>
                  </div>
                )}

                {/* Text Message */}
                {msg.type === 'text' && (
                  <p className="leading-relaxed font-sans whitespace-pre-wrap break-words">
                    {isTranslated && msg.translatedText ? msg.translatedText : msg.text}
                  </p>
                )}

                {/* AI Translation Toggle Button */}
                {msg.translatedText && !isMe && (
                  <button
                    onClick={() => toggleTranslation(msg.id)}
                    className="mt-1.5 pt-1 border-t border-white/10 text-[10px] text-cyan-300 hover:text-cyan-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>
                      {isTranslated
                        ? `${t('originalMessage')} (${msg.originalLang?.toUpperCase()})`
                        : `${t('translateMessage')} ➔ ${currentLang.toUpperCase()}`}
                    </span>
                  </button>
                )}

                {/* Footer Time & Status */}
                <div className="flex items-center justify-end gap-1 mt-1 text-[9px] opacity-75">
                  <span>{msg.timestamp}</span>
                  {isMe && <CheckCheck className="w-3 h-3 text-cyan-200" />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Recording Bar Indicator */}
      {isRecording && (
        <div className="px-4 py-2 bg-red-950/80 border-t border-red-800 text-red-200 flex items-center justify-between text-xs animate-pulse">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <span>{t('recordingVoice')} ({recordingSeconds}s)</span>
          </div>
          <button
            onClick={stopRecording}
            className="px-3 py-1 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold cursor-pointer"
          >
            {t('releaseToSend')}
          </button>
        </div>
      )}

      {/* Message Input Controls */}
      <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
        {/* Photo Attachment */}
        <label className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-all">
          <Image className="w-4 h-4 text-cyan-400" />
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>

        {/* Text Input */}
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={t('typeMessage')}
          className="flex-1 bg-slate-800 rounded-2xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-400 border border-slate-700/80 focus:border-cyan-500 focus:outline-none transition-all"
        />

        {/* Mic Voice Button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`p-2.5 rounded-2xl transition-all cursor-pointer ${
            isRecording
              ? 'bg-red-600 text-white animate-bounce'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
          }`}
          title={t('holdToRecord')}
        >
          <Mic className="w-4 h-4 text-teal-400" />
        </button>

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={!inputText.trim()}
          className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-600 to-teal-500 disabled:opacity-40 text-slate-950 font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer"
          title="Send"
        >
          <Send className={`w-4 h-4 ${direction === 'rtl' ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
};
