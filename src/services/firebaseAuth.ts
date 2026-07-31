import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { User } from '../types';
import { firestoreService } from './firestoreService';

let authInstance: ReturnType<typeof getAuth> | null = null;

try {
  const firebaseConfig = {
    apiKey: "AIzaSyC6c5ao_W-fpyuMtjHksiej88adcgB_6bA",
    authDomain: "vylo-f68f6.firebaseapp.com",
    projectId: "vylo-f68f6",
    storageBucket: "vylo-f68f6.firebasestorage.app",
    messagingSenderId: "803367176965",
    appId: "1:803367176965:web:64c593cc057aa59b95856c",
    measurementId: "G-HS0EG21RD0"
  };

  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  authInstance = getAuth(app);
} catch (e) {
  console.warn('Firebase init notice:', e);
}

export class FirebaseAuthService {
  private activeUser: User | null = null;
  private listeners: ((user: User | null) => void)[] = [];

  constructor() {
    const saved = localStorage.getItem('active_flutter_user');
    if (saved) {
      try {
        this.activeUser = JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved user', e);
      }
    }

    if (authInstance) {
      onAuthStateChanged(authInstance, async (fbUser: FirebaseUser | null) => {
        if (fbUser) {
          const user: User = {
            id: fbUser.uid,
            name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            avatar: fbUser.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            email: fbUser.email || undefined,
            phone: fbUser.phoneNumber || undefined,
            language: 'ar',
            isOnline: true,
            statusText: 'مستخدم متصل عبر تسجيل دخول جوجل'
          };
          this.setActiveUser(user);
          await firestoreService.syncUserProfile(user);
        } else {
          this.setActiveUser(null);
        }
      });
    }
  }

  getActiveUser(): User | null {
    return this.activeUser;
  }

  setActiveUser(user: User | null) {
    this.activeUser = user;
    if (user) {
      localStorage.setItem('active_flutter_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('active_flutter_user');
    }
    this.notifyListeners();
  }

  async signInWithGoogle(): Promise<{ user: User | null; error?: string; domain?: string }> {
    if (authInstance) {
      try {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(authInstance, provider);
        const fbUser = result.user;
        const user: User = {
          id: fbUser.uid,
          name: fbUser.displayName || 'Google User',
          avatar: fbUser.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          email: fbUser.email || undefined,
          phone: fbUser.phoneNumber || undefined,
          language: 'ar',
          isOnline: true,
          statusText: 'حساب جوجل محقق'
        };
        this.setActiveUser(user);
        await firestoreService.syncUserProfile(user);
        return { user };
      } catch (err: any) {
        console.error('Google Sign in error:', err);
        const code = err?.code || '';
        if (code === 'auth/unauthorized-domain') {
          return {
            user: null,
            error: 'unauthorized-domain',
            domain: window.location.hostname
          };
        }
        return {
          user: null,
          error: err?.message || 'فشل تسجيل الدخول عبر جوجل'
        };
      }
    }
    return { user: null, error: 'Firebase Auth is not initialized' };
  }

  async logout(): Promise<void> {
    if (this.activeUser) {
      await firestoreService.setUserPresence(this.activeUser.id, false);
    }
    if (authInstance) {
      try {
        await firebaseSignOut(authInstance);
      } catch (e) {
        console.warn('Firebase logout notice:', e);
      }
    }
    this.setActiveUser(null);
  }

  onUserChange(callback: (user: User | null) => void) {
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

