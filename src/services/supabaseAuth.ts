import { User as AppUser } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { supabaseService } from './supabaseService';

export class SupabaseAuthService {
  private activeUser: AppUser | null = null;
  private listeners: ((user: AppUser | null) => void)[] = [];

  constructor() {
    // Restore locally cached user state if present
    const saved = localStorage.getItem('active_flutter_user');
    if (saved) {
      try {
        this.activeUser = JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved user', e);
      }
    }

    if (isSupabaseConfigured) {
      // Listen to Supabase auth changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          const user = session.user;
          const metadata = user.user_metadata || {};
          const appUser: AppUser = {
            id: user.id,
            name: metadata.full_name || metadata.name || user.email?.split('@')[0] || 'مستخدم',
            avatar: metadata.avatar_url || metadata.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            email: user.email || undefined,
            phone: user.phone || undefined,
            language: 'ar',
            isOnline: true,
            statusText: 'مستخدم متصل عبر حساب Supabase'
          };

          this.setActiveUser(appUser);
          await supabaseService.syncUserProfile(appUser);
        } else if (event === 'SIGNED_OUT') {
          this.setActiveUser(null);
        }
      });
    }
  }

  getActiveUser(): AppUser | null {
    return this.activeUser;
  }

  setActiveUser(user: AppUser | null) {
    this.activeUser = user;
    if (user) {
      localStorage.setItem('active_flutter_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('active_flutter_user');
    }
    this.notifyListeners();
  }

  async signInWithGoogle(): Promise<{ user: AppUser | null; error?: string }> {
    if (!isSupabaseConfigured) {
      return { user: null, error: 'يرجى إعداد VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY في ملف .env' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });

      if (error) {
        return { user: null, error: error.message };
      }

      return { user: this.activeUser };
    } catch (err: any) {
      console.error('Google Supabase Sign-in error:', err);
      return { user: null, error: err?.message || 'فشل تسجيل الدخول عبر جوجل' };
    }
  }

  async logout(): Promise<void> {
    if (this.activeUser) {
      await supabaseService.setUserPresence(this.activeUser.id, false);
    }

    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn('Supabase logout notice:', e);
      }
    }

    this.setActiveUser(null);
  }

  onUserChange(callback: (user: AppUser | null) => void) {
    this.listeners.push(callback);
    callback(this.activeUser);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((l) => l(this.activeUser));
  }
}

export const supabaseAuth = new SupabaseAuthService();
