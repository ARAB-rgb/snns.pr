import React from 'react';
import { Globe, Shield, Sparkles, Check, RefreshCw, LogOut } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { SUPPORTED_LANGUAGES, LanguageCode } from '../types/i18n';
import { User } from '../types';
import { supabaseAuth } from '../services/supabaseAuth';
import { sounds } from '../services/audioSynthesizer';

interface SettingsScreenProps {
  currentUser: User;
  onOpenAuth: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ currentUser, onOpenAuth }) => {
  const { currentLang, setLanguage, autoDetect, setAutoDetect, direction, t } = useLanguage();

  return (
    <div className="flex-1 flex flex-col bg-slate-900 overflow-y-auto p-4 space-y-5 text-slate-100">
      {/* Profile Header */}
      <div className="bg-slate-800/90 rounded-3xl p-4 border border-slate-700/80 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-14 h-14 rounded-full object-cover border-2 border-cyan-400 shadow-md"
          />
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>{currentUser.name}</span>
              <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/30">
                {SUPPORTED_LANGUAGES[currentUser.language]?.flag}
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 truncate max-w-[180px] sm:max-w-[240px]">
              {currentUser.email || currentUser.phone || currentUser.statusText}
            </p>
          </div>
        </div>

        <button
          onClick={onOpenAuth}
          className="p-2.5 rounded-2xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t('switchAccount')}</span>
        </button>
      </div>

      {/* 1. Language & Direction Settings */}
      <div className="bg-slate-800/60 rounded-3xl p-4 border border-slate-700/60 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">{t('language')}</h3>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full">
              {direction === 'rtl' ? t('rtlMode') : t('ltrMode')}
            </span>
          </div>
        </div>

        {/* Auto Detect Toggle */}
        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800 border border-slate-700/60 text-xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="font-semibold text-slate-200">{t('autoDetectLanguage')}</div>
              <div className="text-[10px] text-slate-400">تحديد تلقائي من متصفح الجهاز</div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
          </label>
        </div>

        {/* Language Grid Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
          {Object.values(SUPPORTED_LANGUAGES).map((lang) => {
            const isSelected = currentLang === lang.code;

            return (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code as LanguageCode)}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-gradient-to-tr from-cyan-600/30 to-teal-600/20 border-cyan-500 text-white shadow-md'
                    : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xl">{lang.flag}</span>
                  {isSelected && <Check className="w-4 h-4 text-cyan-400" />}
                </div>

                <div>
                  <div className="text-xs font-bold">{lang.nativeName}</div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between mt-0.5">
                    <span>{lang.name}</span>
                    <span className="uppercase text-[9px] font-semibold">{lang.direction}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Account Info & Logout */}
      <div className="bg-slate-800/60 rounded-3xl p-4 border border-slate-700/60 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
          <Shield className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">أمان الحساب</h3>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          أنت مسجل حالياً عبر حساب جوجل المحقق ({currentUser.email || currentUser.name}). جميع البيانات مشفرة ومحفوظة آمنة في Supabase.
        </p>

        <button
          onClick={() => supabaseAuth.logout()}
          className="w-full py-2.5 rounded-2xl bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>{t('logout')}</span>
        </button>
      </div>
    </div>
  );
};

