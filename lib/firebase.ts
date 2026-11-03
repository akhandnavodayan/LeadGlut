import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB8aUvgg2TgnQD5K4LYzg-r7-RUH5g0LFY",
  authDomain: "leadglut.firebaseapp.com",
  projectId: "leadglut",
  storageBucket: "leadglut.firebasestorage.app",
  messagingSenderId: "746172814704",
  appId: "1:746172814704:web:776a2d6cd4c4ed043e2bb5",
  measurementId: "G-GJKCZZT91L",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
