import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCeT-_51j64AvvM6lAth_884ES2voLA484",
  authDomain: "car-bay-ba243.firebaseapp.com",
  projectId: "car-bay-ba243",
  storageBucket: "car-bay-ba243.firebasestorage.app",
  messagingSenderId: "862417190707",
  appId: "1:862417190707:web:931fdc6096283356578846",
  measurementId: "G-7KWDRM593W"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const logger = (...args) => console.log(...args);

export { auth, db, logger };
