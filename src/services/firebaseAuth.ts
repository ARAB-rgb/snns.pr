import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { User as AppUser } from '../types';
import { supabaseService } from './supabaseService';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyC6c5ao_W-fpyuMtjHksiej88adcgB_6bA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "vylo-f68f6.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "vylo-f68f6",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "vylo-f68f6.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "803367176965",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:803367176965:web:64c593cc057aa59b95856c"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export class FirebaseAuthService {
  private activeUser: AppUser | null = null;
  private listeners: ((user: AppUser | null) => void)[] = [];

  constructor() {
    // Load cached user state if present
    const saved = localStorage.getItem('active_flutter_user');
    if (saved) {
      try {
        this.activeUser = JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved user', e);
      }
    }

    // Listen to Firebase Auth state changes
    onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        const appUser = this.mapFirebaseUserToAppUser(fbUser);
        this.setActiveUser(appUser);
        // Sync user profile to Supabase database profiles table
        await supabaseService.syncUserProfile(appUser);
      } else {
        this.setActiveUser(null);
      }
    });
  }

  private mapFirebaseUserToAppUser(fbUser: FirebaseUser): AppUser {
    return {
      id: fbUser.uid,
      name: fbUser.displayName || fbUser.email?.split('@')[0] || 'مستخدم',
      avatar: fbUser.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      email: fbUser.email || undefined,
      phone: fbUser.phoneNumber || undefined,
      language: 'ar',
      isOnline: true,
      statusText: 'متصل عبر حساب Google (Firebase Auth)'
    };
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
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        const appUser = this.mapFirebaseUserToAppUser(result.user);
        this.setActiveUser(appUser);
        // Save/Sync user profile to Supabase
        await supabaseService.syncUserProfile(appUser);
        return { user: appUser };
      }
      return { user: null, error: 'لم يتم العثور على بيانات المستخدم' };
    } catch (err: any) {
      console.error('Firebase Google Sign-in error:', err);
      let errorMessage = 'فشل تسجيل الدخول عبر جوجل';
      if (err.code === 'auth/popup-closed-by-user') {
        errorMessage = 'تم إغلاق نافذة تسجيل الدخول من قبل المستخدم';
      } else if (err.code === 'auth/unauthorized-domain') {
        errorMessage = 'نطاق التطبيق غير مصرح به في إعدادات Firebase Auth';
      } else if (err.message) {
        errorMessage = err.message;
      }
      return { user: null, error: errorMessage };
    }
  }

  async logout(): Promise<void> {
    if (this.activeUser) {
      await supabaseService.setUserPresence(this.activeUser.id, false);
    }
    try {
      await firebaseSignOut(auth);
    } catch (e) {
      console.warn('Firebase signout warning:', e);
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

export const firebaseAuth = new FirebaseAuthService();
