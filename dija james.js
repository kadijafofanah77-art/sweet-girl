// Minimal WebRTC client that uses your signaling server at http://localhost:4000
// Usage: open two browser tabs at the served folder's `web-client.html` and register different userIds.

const SIGNALING_URL = 'http://localhost:4000';
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let socket;
let pc = null;
let localStream = null;
let remoteStream = null;
let myId = '';
let currentPeerUserId = '';

const el = {
  myId: document.getElementById('myId'),
  targetId: document.getElementById('targetId'),
  btnRegister: document.getElementById('btnRegister'),
  btnCall: document.getElementById('btnCall'),
  btnAccept: document.getElementById('btnAccept'),
  btnReject: document.getElementById('btnReject'),
  btnEnd: document.getElementById('btnEnd'),
  localVideo: document.getElementById('localVideo'),
  remoteVideo: document.getElementById('remoteVideo'),
  status: document.getElementById('status')
};

function logStatus(msg){
  console.log(msg);
  el.status.textContent = msg;
}

function connectSocket(){
  socket = io(SIGNALING_URL, { transports: ['websocket','polling'] });

  socket.on('connect', ()=>logStatus('Socket connected: '+socket.id));

  socket.on('incomingCall', (data)=>{
    logStatus('Incoming call from '+data.fromUserId);
    currentPeerUserId = data.fromUserId;
    // UI: click Accept to answer
  });

  socket.on('callAccepted', (data)=>{
    logStatus('Call accepted by '+data.toUserId);
    // caller continues SDP exchange (we expect answer event later)
  });

  socket.on('callRejected', (data)=>{
    logStatus('Call rejected by '+data.toUserId);
    cleanupCall();
  });

  socket.on('webrtc-offer', async (data)=>{
    logStatus('Received offer from '+data.fromUserId);
    currentPeerUserId = data.fromUserId;
    await ensureLocalStream();
    await createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer',{ fromUserId: myId, toUserId: currentPeerUserId, sdp: pc.localDescription });
  });

  socket.on('webrtc-answer', async (data)=>{
    logStatus('Received answer from '+data.fromUserId);
    if(!pc) return console.warn('No peer connection');
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  });

  socket.on('webrtc-ice-candidate', async (data)=>{
    if(!pc) return;
    try{
      await pc.addIceCandidate(data.candidate);
    }catch(e){ console.warn('Error adding remote ICE candidate',e); }
  });

  socket.on('callEnded', (data)=>{
    logStatus('Call ended by '+data.fromUserId);
    cleanupCall();
  });
}

async function ensureLocalStream(){
  if(localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:true });
    el.localVideo.srcObject = localStream;
    return localStream;
  }catch(e){
    alert('getUserMedia failed: '+e.message);
    throw e;
  }
}

async function createPeerConnection(){
  if(pc) return pc;
  pc = new RTCPeerConnection(configuration);

  remoteStream = new MediaStream();
  el.remoteVideo.srcObject = remoteStream;

  // Add local tracks
  if(localStream){
    for(const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  pc.ontrack = (evt)=>{
    evt.streams[0].getTracks().forEach(t=> remoteStream.addTrack(t));
  };

  pc.onicecandidate = (evt)=>{
    if(evt.candidate){
      socket.emit('webrtc-ice-candidate',{ fromUserId: myId, toUserId: currentPeerUserId, candidate: evt.candidate });
    }
  };

  pc.onconnectionstatechange = ()=>{
    logStatus('PeerConnection state: '+pc.connectionState);
    if(pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') cleanupCall();
  };

  return pc;
}

async function startCall(){
  currentPeerUserId = el.targetId.value.trim();
  if(!currentPeerUserId) return alert('Enter target userId');
  await ensureLocalStream();
  await createPeerConnection();

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // tell signaling server
  socket.emit('startCall',{ fromUserId: myId, toUserId: currentPeerUserId, callType: 'video', channelName: '' });

  // send SDP directly
  socket.emit('webrtc-offer',{ fromUserId: myId, toUserId: currentPeerUserId, sdp: pc.localDescription });
  logStatus('Offer sent to '+currentPeerUserId);
}

async function acceptCall(){
  // inform caller
  socket.emit('acceptCall',{ fromUserId: currentPeerUserId, toUserId: myId, channelName: '' });
  logStatus('Accepted call from '+currentPeerUserId);
}

function rejectCall(){
  socket.emit('rejectCall',{ fromUserId: currentPeerUserId, toUserId: myId });
  cleanupCall();
}

function endCall(){
  socket.emit('endCall',{ fromUserId: myId, toUserId: currentPeerUserId });
  cleanupCall();
}

function cleanupCall(){
  if(pc){
    try{ pc.close(); }catch(e){}
    pc = null;
  }
  if(remoteStream){
    remoteStream.getTracks().forEach(t=>t.stop());
    remoteStream = null;
    el.remoteVideo.srcObject = null;
  }
  if(localStream){
    // keep local stream so user doesn't have to re-grant; if you want to stop:
    // localStream.getTracks().forEach(t=>t.stop()); localStream = null;
    el.localVideo.srcObject = localStream;
  }
  currentPeerUserId = '';
  logStatus('Call cleaned up');
}

// UI bindings
el.btnRegister.onclick = ()=>{
  myId = el.myId.value.trim();
  if(!myId) return alert('Set your userId');
  if(!socket) connectSocket();
  socket.emit('register', myId);
  logStatus('Registered as '+myId);
};

el.btnCall.onclick = startCall;
el.btnAccept.onclick = acceptCall;
el.btnReject.onclick = rejectCall;
el.btnEnd.onclick = endCall;

// Auto-connect socket so user can register quickly
connectSocket();
