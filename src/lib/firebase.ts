import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { EditNoteDoc, WorkspacePrefs } from '../types/editor';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

const googleProvider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach((scope) => googleProvider.addScope(scope));

// In-memory only OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;
let isSigningIn = false;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate Firestore connectivity on app boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function initAuth(
  onAuthChange: (user: User | null, driveToken: string | null) => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedDriveAccessToken = null;
      onAuthChange(null, null);
      return;
    }
    if (!isSigningIn) {
      onAuthChange(user, cachedDriveAccessToken);
    }
  });
}

export async function googleSignIn(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken ?? '';
    cachedDriveAccessToken = accessToken || null;
    return { user: result.user, accessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export async function getFirebaseIdToken(): Promise<string | null> {
  const current = auth.currentUser;
  if (!current) return null;
  return current.getIdToken();
}

export async function logout(): Promise<void> {
  cachedDriveAccessToken = null;
  await auth.signOut();
}

// ---------------------------------------------------------------------------
// Firestore Workspace Preferences & Director Notes (Strict Blueprint Sync)
// ---------------------------------------------------------------------------

export async function ensureUserWorkspace(
  user: User,
  defaults: Omit<WorkspacePrefs, 'ownerId' | 'displayName'>
): Promise<WorkspacePrefs> {
  const path = `users/${user.uid}`;
  const docRef = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        ownerId: user.uid,
        displayName: String(data.displayName ?? user.displayName ?? '').slice(0, 120),
        defaultFps: (data.defaultFps === 30 || data.defaultFps === 60 ? data.defaultFps : 24),
        snapEnabled: Boolean(data.snapEnabled),
        loopTrim: Boolean(data.loopTrim),
        safeGuides: Boolean(data.safeGuides),
        activeProjectTitle: String(data.activeProjectTitle ?? defaults.activeProjectTitle).slice(0, 120),
      };
    }

    const payload = {
      ownerId: user.uid,
      displayName: (user.displayName || user.email || 'Editor').slice(0, 120),
      defaultFps: defaults.defaultFps,
      snapEnabled: defaults.snapEnabled,
      loopTrim: defaults.loopTrim,
      safeGuides: defaults.safeGuides,
      activeProjectTitle: defaults.activeProjectTitle.slice(0, 120),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(docRef, payload);
    return {
      ownerId: payload.ownerId,
      displayName: payload.displayName,
      defaultFps: payload.defaultFps,
      snapEnabled: payload.snapEnabled,
      loopTrim: payload.loopTrim,
      safeGuides: payload.safeGuides,
      activeProjectTitle: payload.activeProjectTitle,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserWorkspacePrefs(
  userId: string,
  updates: Partial<Omit<WorkspacePrefs, 'ownerId'>>
): Promise<void> {
  const path = `users/${userId}`;
  const docRef = doc(db, 'users', userId);
  try {
    const clean: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (typeof updates.displayName === 'string') {
      clean.displayName = updates.displayName.slice(0, 120);
    }
    if (updates.defaultFps === 24 || updates.defaultFps === 30 || updates.defaultFps === 60) {
      clean.defaultFps = updates.defaultFps;
    }
    if (typeof updates.snapEnabled === 'boolean') {
      clean.snapEnabled = updates.snapEnabled;
    }
    if (typeof updates.loopTrim === 'boolean') {
      clean.loopTrim = updates.loopTrim;
    }
    if (typeof updates.safeGuides === 'boolean') {
      clean.safeGuides = updates.safeGuides;
    }
    if (typeof updates.activeProjectTitle === 'string') {
      clean.activeProjectTitle = updates.activeProjectTitle.slice(0, 120);
    }
    await updateDoc(docRef, clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserNotes(
  userId: string,
  onNotes: (notes: EditNoteDoc[]) => void,
  onError?: (err: Error) => void
) {
  const path = `users/${userId}/notes`;
  const q = query(
    collection(db, 'users', userId, 'notes'),
    where('ownerId', '==', userId),
    orderBy('timecodeSec', 'asc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: EditNoteDoc[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? userId),
          projectTitle: String(data.projectTitle ?? ''),
          timecodeSec: Number(data.timecodeSec ?? 0),
          content: String(data.content ?? ''),
          category:
            data.category === 'color' ||
            data.category === 'audio' ||
            data.category === 'research'
              ? data.category
              : 'cut',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      onNotes(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function createEditNote(
  userId: string,
  input: {
    projectTitle: string;
    timecodeSec: number;
    content: string;
    category: 'cut' | 'color' | 'audio' | 'research';
  }
): Promise<void> {
  const noteId = `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `users/${userId}/notes/${noteId}`;
  const docRef = doc(db, 'users', userId, 'notes', noteId);
  try {
    await setDoc(docRef, {
      ownerId: userId,
      projectTitle: (input.projectTitle.trim() || 'Untitled Sequence').slice(0, 120),
      timecodeSec: Math.max(0, Math.min(86400, Number(input.timecodeSec) || 0)),
      content: input.content.trim().slice(0, 1000),
      category: input.category,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteEditNote(userId: string, noteId: string): Promise<void> {
  const path = `users/${userId}/notes/${noteId}`;
  const docRef = doc(db, 'users', userId, 'notes', noteId);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
