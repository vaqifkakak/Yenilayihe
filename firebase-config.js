import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_isJ_NYHqKMmSFolLwrLXBRQrCTmL3x4",
  authDomain: "yenilayihe-c5a46.firebaseapp.com",
  projectId: "yenilayihe-c5a46",
  storageBucket: "yenilayihe-c5a46.firebasestorage.app",
  messagingSenderId: "260808745664",
  appId: "1:260808745664:web:c3f40b8e1b99c8e8f2c325",
  measurementId: "G-091T3655MC"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const logger = (...args) => console.log(...args);

export { auth, db, logger };
