import React, { useState, useEffect } from 'react';
import { LanguageProvider } from './i18n/LanguageContext';
import { FlutterPhoneFrame } from './components/FlutterPhoneFrame';
import { Header } from './components/Header';
import { BottomNav, TabType } from './components/BottomNav';
import { ChatList } from './components/ChatList';
import { ChatDetail } from './components/ChatDetail';
import { CallList } from './components/CallList';
import { CallScreen } from './components/CallScreen';
import { IncomingCallOverlay } from './components/IncomingCallOverlay';
import { ContactsList } from './components/ContactsList';
import { SettingsScreen } from './components/SettingsScreen';
import { AuthModal } from './components/AuthModal';

import { User, Message, CallLog, ActiveCallState } from './types';
import { firebaseAuth } from './services/firebaseAuth';
import { firestoreService } from './services/firestoreService';
import { zegoService } from './services/zegocloud';
import { sounds } from './services/audioSynthesizer';

function AppContent() {
  const [currentUser, setCurrentUser] = useState<User | null>(firebaseAuth.getActiveUser());
  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);

  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ callId: string; caller: User; type: 'audio' | 'video' } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Subscribe to Firebase Auth User Changes
  useEffect(() => {
    const unsubscribe = firebaseAuth.onUserChange((user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to Real Firestore Users
  useEffect(() => {
    if (!currentUser) {
      setUsers([]);
      return;
    }
    const unsub = firestoreService.subscribeUsers(currentUser.id, (userList) => {
      setUsers(userList);
    });
    return () => unsub();
  }, [currentUser]);

  // Subscribe to Real Firestore Call Logs
  useEffect(() => {
    if (!currentUser) {
      setCallLogs([]);
      return;
    }
    const unsub = firestoreService.subscribeCallLogs(currentUser.id, (logs) => {
      setCallLogs(logs);
    });
    return () => unsub();
  }, [currentUser]);

  // Subscribe to Real Incoming Calls
  useEffect(() => {
    if (!currentUser) return;
    const unsub = firestoreService.subscribeIncomingCalls(currentUser.id, (inc) => {
      if (inc) {
        const callerObj = users.find((u) => u.id === inc.callerId) || {
          id: inc.callerId,
          name: 'متصل جديد',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
          language: 'ar',
          isOnline: true
        };
        setIncomingCall({ callId: inc.callId, caller: callerObj, type: inc.type });
      } else {
        setIncomingCall(null);
      }
    });
    return () => unsub();
  }, [currentUser, users]);

  // Subscribe to Messages when a chat is open
  useEffect(() => {
    if (!currentUser || !selectedUser) return;
    const convId = firestoreService.getConversationId(currentUser.id, selectedUser.id);
    const unsub = firestoreService.subscribeMessages(convId, (msgList) => {
      setMessages((prev) => ({
        ...prev,
        [selectedUser.id]: msgList
      }));
    });
    return () => unsub();
  }, [currentUser, selectedUser]);

  // Start outgoing call
  const startCall = async (participant: User, type: 'audio' | 'video') => {
    if (!currentUser) return;

    const callId = await firestoreService.createCall(currentUser.id, participant.id, type);
    const roomId = zegoService.generateRoomId(participant.id);

    setActiveCall({
      id: callId || `call_${Date.now()}`,
      roomId,
      participant,
      type,
      status: 'connected',
      isMuted: false,
      isVideoOff: false,
      isSpeakerOn: true,
      isScreenSharing: false,
      isFrontCamera: true,
      durationSeconds: 0,
      hasLocalVideo: true,
      hasRemoteVideo: true,
      signalQuality: 'excellent'
    });
  };

  // Accept incoming call
  const acceptIncomingCall = async () => {
    if (!incomingCall || !currentUser) return;

    await firestoreService.updateCallStatus(incomingCall.callId, 'accepted');
    const roomId = zegoService.generateRoomId(incomingCall.caller.id);

    setActiveCall({
      id: incomingCall.callId,
      roomId,
      participant: incomingCall.caller,
      type: incomingCall.type,
      status: 'connected',
      isMuted: false,
      isVideoOff: false,
      isSpeakerOn: true,
      isScreenSharing: false,
      isFrontCamera: true,
      durationSeconds: 0,
      hasLocalVideo: true,
      hasRemoteVideo: true,
      signalQuality: 'excellent'
    });

    setIncomingCall(null);
  };

  // Decline incoming call
  const declineIncomingCall = async () => {
    if (incomingCall) {
      await firestoreService.updateCallStatus(incomingCall.callId, 'rejected');
    }
    setIncomingCall(null);
  };

  // End active call
  const endActiveCall = async () => {
    if (activeCall) {
      await firestoreService.updateCallStatus(activeCall.id, 'ended', activeCall.durationSeconds);
      setActiveCall(null);
    }
  };

  // Send real Firestore message
  const handleSendMessage = async (text: string, type: 'text' | 'audio' | 'image' = 'text', mediaUrl?: string) => {
    if (!selectedUser || !currentUser) return;
    await firestoreService.sendMessage(currentUser.id, selectedUser.id, text, type, mediaUrl);
  };

  const missedCount = callLogs.filter((c) => c.direction === 'missed').length;

  if (!currentUser) {
    return (
      <FlutterPhoneFrame>
        <AuthModal currentUser={null} />
      </FlutterPhoneFrame>
    );
  }

  return (
    <FlutterPhoneFrame>
      {/* Active Video/Audio Call View */}
      {activeCall && (
        <CallScreen callState={activeCall} onEndCall={endActiveCall} />
      )}

      {/* Incoming Call Popup Ring */}
      {incomingCall && (
        <IncomingCallOverlay
          caller={incomingCall.caller}
          type={incomingCall.type}
          onAccept={acceptIncomingCall}
          onDecline={declineIncomingCall}
        />
      )}

      {/* Main Flutter Navigation Framework */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        {!selectedUser && (
          <Header
            currentUser={currentUser}
            onOpenSettings={() => setActiveTab('settings')}
            onOpenAuth={() => setShowAuthModal(true)}
          />
        )}

        {/* Dynamic Tab Body or Active Chat Detail */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {selectedUser ? (
            <ChatDetail
              currentUserId={currentUser.id}
              participant={selectedUser}
              messages={messages[selectedUser.id] || []}
              onBack={() => setSelectedUser(null)}
              onSendMessage={handleSendMessage}
              onStartCall={startCall}
            />
          ) : (
            <>
              {activeTab === 'chats' && (
                <ChatList
                  users={users}
                  messages={messages}
                  onSelectUser={(u) => setSelectedUser(u)}
                  onStartCall={startCall}
                  onNewChat={() => setActiveTab('contacts')}
                />
              )}

              {activeTab === 'calls' && (
                <CallList
                  callLogs={callLogs}
                  users={users}
                  onStartCall={startCall}
                  onNewCall={() => setActiveTab('contacts')}
                />
              )}

              {activeTab === 'contacts' && (
                <ContactsList
                  users={users}
                  onSelectUser={(u) => setSelectedUser(u)}
                  onStartCall={startCall}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsScreen
                  currentUser={currentUser}
                  onOpenAuth={() => setShowAuthModal(true)}
                />
              )}
            </>
          )}
        </main>

        {/* Bottom Flutter Material 3 Navigation Bar */}
        {!selectedUser && (
          <BottomNav
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            unreadCount={0}
            missedCallCount={missedCount}
          />
        )}
      </div>

      {/* Firebase Auth Modal */}
      {showAuthModal && (
        <AuthModal
          currentUser={currentUser}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </FlutterPhoneFrame>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

