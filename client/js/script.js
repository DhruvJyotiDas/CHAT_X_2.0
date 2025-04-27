
let socket;
let username;
let authToken;
let selectedRecipient = null;
let localStream;
let peerConnection;

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// DOM Elements
const callBtn = document.getElementById("call-btn");
const videoPopup = document.getElementById("video-popup");
const incomingCallPopup = document.getElementById("incoming-call-popup");
const incomingCallText = document.getElementById("incoming-call-text");

const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const muteBtn = document.getElementById("mute-btn");
const cameraBtn = document.getElementById("camera-btn");
const endCallBtn = document.getElementById("end-call-btn");
const acceptCallBtn = document.getElementById("accept-call-btn");
const declineCallBtn = document.getElementById("decline-call-btn");

console.log("✅ script.js loaded!");

window.onload = async function () {
  username = localStorage.getItem("username");
  const password = localStorage.getItem("password");

  if (!username || !password) {
    alert("Login info not found. Redirecting to login page.");
    window.location.href = "login.html";
    return;
  }

  document.querySelector(".welcome").textContent = `Welcome, ${username}`;

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    authToken = data.token || "dummy-token";
    connectWebSocket();
  } catch (err) {
    alert("Login failed or session expired.");
    window.location.href = "login.html";
  }
};

function connectWebSocket() {
  socket = new WebSocket("ws://localhost:8000");

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "connect", username, token: authToken }));
  };

  socket.onmessage = handleSocketMessage;
  socket.onerror = () => alert("WebSocket error.");
  socket.onclose = () => console.warn("WebSocket disconnected");
}

async function handleSocketMessage(event) {
  const data = JSON.parse(event.data);

  if (data.type === "updateUsers") {
    const container = document.getElementById("user-items-container");
    container.innerHTML = "";
    data.users.forEach(user => {
      if (user !== username) {
        const el = document.createElement("div");
        el.className = "user-item";
        el.textContent = user;
        el.onclick = async () => {
          selectedRecipient = user;
          document.getElementById("chat-title").textContent = user;
          document.getElementById("chat-box").innerHTML = "";
          const callBtn = document.getElementById("call-btn");
          if (callBtn) {
            callBtn.onclick = async () => {
              if (!selectedRecipient) return alert("Select a user first.");
            
              await startLocalStream();
              createPeerConnection();
              addLocalTracks();
              videoPopup.classList.remove("hidden");
            
              const offer = await peerConnection.createOffer();
              await peerConnection.setLocalDescription(offer);
            
              socket.send(JSON.stringify({
                type: "call-offer",
                from: username,
                to: selectedRecipient,
                offer: offer
              }));
            };
            
          }

          try {
            const res = await fetch(`/history?user=${username}&peer=${user}`);
            const messages = await res.json();
            messages.forEach(renderMessage);
          } catch (err) {
            console.error("History fetch error:", err);
          }
        };
        container.appendChild(el);
      }
    });
  }

  else if (data.type === "message") {
    updateEmoji(data.mood);
    renderMessage(data);
  }

  else if (data.type === "typing") {
    showTypingIndicator(data.sender);
  }

  else if (data.type === "call-request") {
    selectedRecipient = data.from;
    incomingCallText.textContent = `${data.from} is calling you...`;
    incomingCallPopup.classList.remove("hidden");

    acceptCallBtn.onclick = async () => {
      incomingCallPopup.classList.add("hidden");
      await startLocalStream();
    
      createPeerConnection();
      addLocalTracks();
    
      // Set remote offer (from caller)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    
      // Create and send the answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
    
      socket.send(JSON.stringify({
        type: "call-accepted",
        from: username,
        to: selectedRecipient,
        answer: answer
      }));
    
      videoPopup.classList.remove("hidden");
    };
    

    declineCallBtn.onclick = () => {
      incomingCallPopup.classList.add("hidden");
      socket.send(JSON.stringify({ type: "call-declined", from: username, to: data.from }));
    };
  }

  else if (data.type === "call-accepted") {
    console.log("✅ Call accepted by", data.from);
  
    // 1. Show caller's video box
    videoPopup.classList.remove("hidden");
  
    // 2. Start local camera stream
    await startLocalStream();
  
    // 3. Create peer connection & add local stream
    createPeerConnection();     // This should initialize your RTCPeerConnection
    addLocalTracks();           // This adds camera/mic tracks to the peerConnection
  
    // 4. Set remote answer
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
  

  else if (data.type === "call-offer") {
    incomingCallPopup.classList.remove("hidden");
    incomingCallText.textContent = `${data.from} is calling you...`;
  
    acceptCallBtn.onclick = async () => {
      incomingCallPopup.classList.add("hidden");
  
      await startLocalStream();
      createPeerConnection();
      addLocalTracks();
  
      await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteOffer));

  
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
  
      socket.send(JSON.stringify({
        type: "call-answer",
        from: username,
        to: data.from,
        answer: answer
      }));
  
      videoPopup.classList.remove("hidden");
    };
  
    declineCallBtn.onclick = () => {
      incomingCallPopup.classList.add("hidden");
      socket.send(JSON.stringify({ type: "call-declined", from: username, to: data.from }));
    };
  }
  

  else if (data.type === "call-answer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  }

  else if (data.type === "call-candidate") {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error("Error adding ICE candidate:", err);
    }
  }
}



async function summarizeMessage(originalText) {
  try {
    const res = await fetch("https://f686-2401-4900-634f-e92e-4924-7f86-639a-3db8.ngrok-free.app/summarize", {  // 👈 use your Mac IP here
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: originalText }),
    });

    const data = await res.json();
    return data.summary || originalText;
  } catch (err) {
    console.error("Summarization error:", err);
    return originalText;
  }
}


function createPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: "call-candidate",
        to: selectedRecipient,
        from: username,
        candidate: event.candidate,
      }));
    }
  };

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };
}

function addLocalTracks() {
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
}

async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    videoPopup.classList.remove("hidden");
  } catch (err) {
    alert("Camera/Mic permission denied.");
  }
}

// === Controls ===
muteBtn?.addEventListener("click", () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;
  muteBtn.textContent = audioTrack.enabled ? "🔇" : "🔊";
});

cameraBtn?.addEventListener("click", () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  cameraBtn.textContent = videoTrack.enabled ? "📷" : "📸";
});

endCallBtn?.addEventListener("click", () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  videoPopup.classList.add("hidden");
});

// Emoji & Chat UI
function renderMessage({ sender, message, timestamp }) {
  const templateId = sender === username ? "message-template-sent" : "message-template-received";
  const template = document.getElementById(templateId);
  const clone = template.content.cloneNode(true);

  const contentEl = clone.querySelector(".content");
  const summarizeBtn = clone.querySelector(".summarize-btn");

  contentEl.textContent = message;
  if (sender !== username) clone.querySelector(".sender").textContent = sender;

  const time = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  clone.querySelector(".meta").textContent = time;

  // 🧠 Add toggle logic
  let isSummarized = false;
  let originalText = message;
  let summarizedText = "";

  summarizeBtn.addEventListener("click", async () => {
    if (!isSummarized && summarizedText === "") {
      summarizeBtn.innerText = "Loading...";
      try {
        summarizedText = await summarizeMessage(originalText);
        contentEl.textContent = summarizedText;
        summarizeBtn.innerText = "Show Original";
        isSummarized = true;
      } catch (err) {
        console.error("Summarization failed", err);
        summarizeBtn.innerText = "Retry";
      }
    } else {
      // toggle
      isSummarized = !isSummarized;
      contentEl.textContent = isSummarized ? summarizedText : originalText;
      summarizeBtn.innerText = isSummarized ? "Show Original" : "Summarize";
    }
  });
  

  const box = document.getElementById("chat-box");
  box.appendChild(clone);
  box.scrollTop = box.scrollHeight;
}


function updateEmoji(mood) {
  const emojiMap = {
    happy: "😄", sad: "😢", angry: "😠", neutral: "😐"
  };
  document.getElementById("live-emoji").textContent = emojiMap[mood] || "😐";
}

function showTypingIndicator(sender) {
  const id = `typing-${sender}`;
  if (document.getElementById(id)) return;

  const el = document.createElement("div");
  el.id = id;
  el.className = "message status";
  el.textContent = `${sender} is typing...`;
  document.getElementById("chat-box").appendChild(el);

  setTimeout(() => {
    const remove = document.getElementById(id);
    if (remove) remove.remove();
  }, 3000);
}

const sendBtn = document.getElementById("send-btn");
const messageInput = document.getElementById("message");

sendBtn?.addEventListener("click", () => {
  const msg = messageInput.value.trim();
  if (!msg || !selectedRecipient) return;

  const payload = {
    type: "message",
    sender: username,
    recipient: selectedRecipient,
    message: msg,
    timestamp: Date.now()
  };
  socket.send(JSON.stringify(payload));
  renderMessage(payload);
  messageInput.value = "";
});

messageInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
  else if (selectedRecipient) {
    socket.send(JSON.stringify({
      type: "typing",
      sender: username,
      recipient: selectedRecipient
    }));
  }
});
