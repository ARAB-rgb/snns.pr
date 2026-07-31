import React, { useState } from 'react';
import { Search, MessageSquare, Phone, Video, UserPlus } from 'lucide-react';
import { User } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../types/i18n';

interface ContactsListProps {
  users: User[];
  onSelectUser: (user: User) => void;
  onStartCall: (participant: User, type: 'audio' | 'video') => void;
}

export const ContactsList: React.FC<ContactsListProps> = ({
  users,
  onSelectUser,
  onStartCall
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useLanguage();

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.phone?.includes(q) || u.email?.includes(q);
  });

  return (
    <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden relative">
      <div className="p-3 bg-slate-900 border-b border-slate-800">
        <div className="relative flex items-center bg-slate-800/90 rounded-2xl border border-slate-700/80 px-3 py-2 text-slate-200 focus-within:border-cyan-500/80 transition-all">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search')}
            className="w-full bg-transparent px-2.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-2 space-y-1">
        {filteredUsers.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
            <UserPlus className="w-10 h-10 mb-2 text-slate-600" />
            <p className="text-xs">لا توجد جهات اتصال مسجلة بعد</p>
          </div>
        ) : (
          filteredUsers.map((user) => {
          const langInfo = SUPPORTED_LANGUAGES[user.language];

          return (
            <div
              key={user.id}
              className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-800/80 transition-all group"
            >
              <div
                onClick={() => onSelectUser(user)}
                className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
              >
                <div className="relative shrink-0">
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-11 h-11 rounded-full object-cover border border-slate-700"
                  />
                  {user.isOnline && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-xs text-slate-100 truncate flex items-center gap-1.5">
                    <span>{user.name}</span>
                    <span className="text-[10px]">{langInfo.flag}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 truncate">{user.statusText}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                <button
                  onClick={() => onSelectUser(user)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all cursor-pointer"
                  title={t('chats')}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                </button>

                <button
                  onClick={() => onStartCall(user, 'audio')}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-cyan-600/30 text-cyan-300 transition-all cursor-pointer"
                  title={t('audioCall')}
                >
                  <Phone className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onStartCall(user, 'video')}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-teal-600/30 text-teal-300 transition-all cursor-pointer"
                  title={t('videoCall')}
                >
                  <Video className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
};
