
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch, runTransaction, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyApkEjZ_VZ2hvRSIrSrp3raWa5Qi49VLsk",
  authDomain: "market-place-fake.firebaseapp.com",
  projectId: "market-place-fake",
  storageBucket: "market-place-fake.firebasestorage.app",
  messagingSenderId: "467148878397",
  appId: "1:467148878397:web:f8454f8d977d0292e47054",
  measurementId: "G-Z9CYVBP16B"
};


export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  updateProfile,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  runTransaction,
  increment,
  arrayUnion,
  ref,
  uploadBytes,
  getDownloadURL
};
