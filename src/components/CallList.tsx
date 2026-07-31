import React from 'react';
import { Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, Plus } from 'lucide-react';
import { CallLog, User } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../types/i18n';

interface CallListProps {
  callLogs: CallLog[];
  users: User[];
  onStartCall: (participant: User, type: 'audio' | 'video') => void;
  onNewCall: () => void;
}

export const CallList: React.FC<CallListProps> = ({
  callLogs,
  users,
  onStartCall,
  onNewCall
}) => {
  const { t } = useLanguage();

  return (
    <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden relative">
      <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">{t('calls')}</h2>
        <span className="text-[11px] text-cyan-400 font-medium">ZegoCloud Engine</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 p-2 space-y-1">
        {callLogs.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
            <Phone className="w-10 h-10 mb-2 text-slate-600" />
            <p className="text-xs">{t('noCallsYet')}</p>
          </div>
        ) : (
          callLogs.map((log) => {
            const participant = users.find((u) => u.id === log.participantId);
            if (!participant) return null;

            const langInfo = SUPPORTED_LANGUAGES[participant.language];

            return (
              <div
                key={log.id}
                className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-800/80 transition-all group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <img
                    src={participant.avatar}
                    alt={participant.name}
                    className="w-11 h-11 rounded-full object-cover border border-slate-700"
                  />

                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-xs text-slate-100 truncate flex items-center gap-1.5">
                      <span>{participant.name}</span>
                      <span className="text-[10px]">{langInfo.flag}</span>
                    </h3>

                    <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                      {log.direction === 'incoming' && (
                        <PhoneIncoming className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      {log.direction === 'outgoing' && (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-cyan-400" />
                      )}
                      {log.direction === 'missed' && (
                        <PhoneMissed className="w-3.5 h-3.5 text-red-400" />
                      )}

                      <span
                        className={
                          log.direction === 'missed'
                            ? 'text-red-400 font-medium'
                            : 'text-slate-400'
                        }
                      >
                        {log.timestamp} {log.duration ? `(${log.duration})` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => onStartCall(participant, log.type)}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-cyan-600/30 text-cyan-300 border border-slate-700 hover:border-cyan-500/40 transition-all cursor-pointer ml-2"
                  title={`Call ${participant.name}`}
                >
                  {log.type === 'video' ? (
                    <Video className="w-4 h-4 text-teal-400" />
                  ) : (
                    <Phone className="w-4 h-4 text-cyan-400" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={onNewCall}
        className="absolute bottom-4 right-4 ltr:right-4 rtl:left-4 w-13 h-13 rounded-2xl bg-gradient-to-tr from-cyan-600 to-teal-500 text-slate-950 font-bold shadow-lg shadow-cyan-950/60 flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer z-10"
        title={t('newCall')}
      >
        <Plus className="w-6 h-6 stroke-[3]" />
      </button>
    </div>
  );
};
