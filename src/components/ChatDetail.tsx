import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft, Phone, Video, Send, Mic, Image, Paperclip,
  Smile, Trash2, Reply, X, Play, Pause, CheckCheck,
  Sparkles, FileText, Download
} from 'lucide-react';
import { User, Message } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../types/i18n';
import { sounds } from '../services/audioSynthesizer';
import { supabaseService } from '../services/supabaseService';

interface ChatDetailProps {
  currentUserId: string;
  participant: User;
  messages: Message[];
  onBack: () => void;
  onSendMessage: (
    text: string,
    type?: 'text' | 'audio' | 'image' | 'file',
    mediaUrl?: string,
    fileName?: string,
    replyTo?: { id: string; text: string; senderName?: string }
  ) => void;
  onDeleteMessage?: (messageId: string) => void;
  onStartCall: (participant: User, type: 'audio' | 'video') => void;
}

const EMOJI_LIST = ['😀', '😂', '😍', '👍', '❤️', '🔥', '🎉', '🙏', '😊', '🤝', '🙌', '✨'];

export const ChatDetail: React.FC<ChatDetailProps> = ({
  currentUserId,
  participant,
  messages,
  onBack,
  onSendMessage,
  onDeleteMessage,
  onStartCall
}) => {
  const { currentLang, direction, t } = useLanguage();
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [translatedMessages, setTranslatedMessages] = useState<Record<string, boolean>>({});
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; senderName?: string } | null>(null);

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

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          const uploadedUrl = await supabaseService.uploadAttachment(audioBlob, `voice_${Date.now()}.webm`, 'audio/webm');
          const finalUrl = uploadedUrl || base64Audio;
          onSendMessage('تسجيل صوتي', 'audio', finalUrl, 'voice_note.webm', replyingTo || undefined);
          setReplyingTo(null);
          sounds.playMessageSentSound();
        };
        reader.readAsDataURL(audioBlob);
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
      onSendMessage('تسجيل صوتي', 'audio', '#', undefined, replyingTo || undefined);
      setReplyingTo(null);
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
    onSendMessage(inputText.trim(), 'text', undefined, undefined, replyingTo || undefined);
    setInputText('');
    setReplyingTo(null);
    setShowEmojiPicker(false);
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
      reader.onload = async (event) => {
        if (event.target?.result) {
          const base64Data = event.target.result as string;
          const uploadedUrl = await supabaseService.uploadAttachment(file, file.name, file.type);
          const finalUrl = uploadedUrl || base64Data;
          onSendMessage('صورة', 'image', finalUrl, file.name, replyingTo || undefined);
          setReplyingTo(null);
          sounds.playMessageSentSound();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          const base64Data = event.target.result as string;
          const uploadedUrl = await supabaseService.uploadAttachment(file, file.name, file.type);
          const finalUrl = uploadedUrl || base64Data;
          onSendMessage(`ملف: ${file.name}`, 'file', finalUrl, file.name, replyingTo || undefined);
          setReplyingTo(null);
          sounds.playMessageSentSound();
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const addEmoji = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  const langInfo = SUPPORTED_LANGUAGES[participant.language] || SUPPORTED_LANGUAGES['ar'];

  return (
    <div className="flex-1 flex flex-col bg-slate-950 h-full overflow-hidden relative">
      {/* Top Header */}
      <div className="px-3 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
            title="رجوع"
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
              {langInfo && <span className="text-[10px] opacity-90">{langInfo.flag}</span>}
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
              className={`group relative flex flex-col ${isMe ? 'items-end' : 'items-start'} transition-all`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[70%] p-3 rounded-2xl shadow-md text-xs relative ${
                  isMe
                    ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-br-none'
                    : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/80'
                }`}
              >
                {/* Reply Context Header if msg has replyTo */}
                {msg.replyTo && (
                  <div className="mb-2 p-2 rounded-xl bg-black/20 border-l-2 border-cyan-300 text-[11px] text-slate-200">
                    <span className="font-bold text-cyan-300 block text-[10px]">
                      {msg.replyTo.senderName || 'رد على:'}
                    </span>
                    <span className="truncate block opacity-90">{msg.replyTo.text}</span>
                  </div>
                )}

                {/* Media Image */}
                {msg.type === 'image' && msg.mediaUrl && (
                  <img
                    src={msg.mediaUrl}
                    alt="attachment"
                    className="max-w-full max-h-52 rounded-xl object-cover mb-2 border border-black/20"
                  />
                )}

                {/* File Attachment */}
                {msg.type === 'file' && (
                  <a
                    href={msg.mediaUrl || '#'}
                    download={msg.fileName || 'file'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 p-2 rounded-xl bg-black/20 hover:bg-black/30 border border-white/10 text-white mb-1 transition-all"
                  >
                    <FileText className="w-5 h-5 text-cyan-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-xs truncate">{msg.fileName || 'ملف مرفق'}</p>
                      <span className="text-[10px] text-slate-300 opacity-80">تنزيل الملف</span>
                    </div>
                    <Download className="w-4 h-4 text-cyan-300 shrink-0" />
                  </a>
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
                      <span className="text-[9px] opacity-80 mt-0.5 block">تسجيل صوتي</span>
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

                {/* Message Hover Actions (Reply & Delete) */}
                <div
                  className={`absolute top-1 ${
                    isMe ? '-left-16' : '-right-16'
                  } hidden group-hover:flex items-center gap-1 bg-slate-900/90 border border-slate-700 rounded-xl p-1 shadow-lg z-20`}
                >
                  <button
                    onClick={() =>
                      setReplyingTo({
                        id: msg.id,
                        text: msg.type === 'text' ? msg.text : msg.type === 'image' ? '📷 صورة' : '📁 ملف',
                        senderName: isMe ? 'أنت' : participant.name
                      })
                    }
                    className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-cyan-400 cursor-pointer"
                    title="رد"
                  >
                    <Reply className="w-3.5 h-3.5" />
                  </button>

                  {onDeleteMessage && (
                    <button
                      onClick={() => onDeleteMessage(msg.id)}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-red-400 cursor-pointer"
                      title="حذف الرسالة"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Banner */}
      {replyingTo && (
        <div className="px-3 py-2 bg-slate-900/95 border-t border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 min-w-0 border-l-2 border-cyan-400 pl-2">
            <Reply className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-cyan-300 text-[11px] block">{replyingTo.senderName}</span>
              <p className="text-slate-300 truncate text-[11px]">{replyingTo.text}</p>
            </div>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="p-1 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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

      {/* Emoji Bar Picker */}
      {showEmojiPicker && (
        <div className="p-2 bg-slate-900 border-t border-slate-800 flex items-center gap-1.5 overflow-x-auto">
          {EMOJI_LIST.map((emoji) => (
            <button
              key={emoji}
              onClick={() => addEmoji(emoji)}
              className="p-1.5 text-base hover:bg-slate-800 rounded-xl transition-all cursor-pointer shrink-0"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Message Input Controls */}
      <div className="p-2.5 bg-slate-900 border-t border-slate-800 flex items-center gap-1.5">
        {/* Emoji Button */}
        <button
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-all"
          title="إيموجي"
        >
          <Smile className="w-4 h-4 text-amber-400" />
        </button>

        {/* Photo Attachment */}
        <label className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-all" title="إرسال صورة">
          <Image className="w-4 h-4 text-cyan-400" />
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </label>

        {/* File Attachment */}
        <label className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer transition-all" title="إرسال ملف">
          <Paperclip className="w-4 h-4 text-teal-400" />
          <input type="file" className="hidden" onChange={handleFileUpload} />
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
          title="إرسال"
        >
          <Send className={`w-4 h-4 ${direction === 'rtl' ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
};
