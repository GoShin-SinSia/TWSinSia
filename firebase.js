import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDvE50eHWtOS5pQwHiR3gKCRYKRtVGiQCI",
  authDomain: "mapu-53433.firebaseapp.com",
  projectId: "mapu-53433",
  storageBucket: "mapu-53433.firebasestorage.app",
  messagingSenderId: "570966584852",
  appId: "1:570966584852:web:2db2da9915f737036ac101",
  measurementId: "G-V19QPREXNN"
};

const fbApp  = initializeApp(firebaseConfig);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

// ── Google 登入 ──────────────────────────────
document.getElementById('google-login-btn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('登入失敗', e);
  }
});

// ── 登出 ─────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// ── 監聽登入狀態 ──────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('main-app').style.display = 'none';
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('user-avatar').src = user.photoURL || '';
  document.getElementById('user-name').textContent = user.displayName || user.email;

  // 從 Firestore 讀取該使用者的進度
  const snap = await getDoc(doc(db, 'users', user.uid));
  const data = snap.exists() ? snap.data() : {};

  window._firebaseUser   = user;
  window.collected       = new Set((data.collected || []).map(Number));
  window.unlockedStories = new Map(Object.entries(data.stories || {}));
  window.items           = new Map(Object.entries(data.items || {}));
  window.solved          = new Set(data.solved || []);
  window.earnedBadges    = new Map(Object.entries(data.badges || {}));
  window.aiStories       = new Map(
    Object.entries(data.aiStories || {}).map(([k, v]) => [k, deserializeAIStory(k, v)])
  );

  window.onGameDataLoaded();
});

// ── 儲存進度到 Firestore ──────────────────────
window.saveProgress = async function () {
  const user = window._firebaseUser;
  if (!user) return;
  const aiStories = {};
  for (const [k, v] of window.aiStories || []) aiStories[k] = serializeAIStory(v);

  await setDoc(doc(db, 'users', user.uid), {
    collected: [...window.collected],
    stories:   Object.fromEntries(window.unlockedStories || []),
    items:     Object.fromEntries(window.items || []),
    solved:    [...(window.solved || [])],
    badges:    Object.fromEntries(window.earnedBadges || []),
    aiStories,
  }, { merge: true });
};
window.saveCollected = window.saveProgress; // 舊名稱相容
