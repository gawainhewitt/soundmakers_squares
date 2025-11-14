// Simple Web Audio API engine
export class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.activeOscillators = new Map();
    this.allOscillators = []; // Track EVERY oscillator ever created
    this.masterGain = null;
    this.initialized = false;
  }

  // Initialize audio context (must be called after user interaction on iOS)
  async init() {
    if (this.initialized) return;
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create a dummy buffer to "unlock" audio on iOS Chrome
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);
      
      // Create master gain for volume control
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.2;
      this.masterGain.connect(this.audioContext.destination);
      
      // Resume context
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.initialized = true;
      console.log('AudioContext initialized:', this.audioContext.state);
    } catch (error) {
      console.error('Failed to initialize audio:', error);
    }
  }

  // Convert note name to frequency
  noteToFrequency(note) {
    const notes = {
      'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
      'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
      'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
    };
    
    const noteName = note.slice(0, -1);
    const octave = parseInt(note.slice(-1));
    const semitone = notes[noteName];
    
    // A4 = 440Hz
    const A4 = 440;
    const semitonesFromA4 = (octave - 4) * 12 + (semitone - 9);
    
    return A4 * Math.pow(2, semitonesFromA4 / 12);
  }

  playNote(note) {
    if (!this.audioContext || this.audioContext.state !== 'running') {
      console.warn('AudioContext not ready');
      return;
    }
    
    // CRITICAL: Always stop existing note first
    this.stopNote(note);
    
    const freq = this.noteToFrequency(note);
    const now = this.audioContext.currentTime;
    
    // Create multiple sawtooth oscillators for richer sound
    const oscillators = [];
    const numOscillators = 1;
    
    // Create gain node for the note
    const noteGain = this.audioContext.createGain();
    noteGain.gain.setValueAtTime(0, now);
    
    // Create low-pass filter to reduce harshness
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500; // Cutoff frequency - adjust this to taste
    filter.Q.value = 0; // Resonance - adjust for character
    
    // Create oscillators with slight detuning
    for (let i = 0; i < numOscillators; i++) {
      const osc = this.audioContext.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      
      const detuneAmount = (i - numOscillators / 2) * 2;
      osc.detune.value = detuneAmount;
      
      const oscGain = this.audioContext.createGain();
      oscGain.gain.value = 1 / numOscillators;
      
      // Connect: oscillator -> oscGain -> filter -> noteGain
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(now);
      
      // Track this oscillator globally with metadata
      const oscData = {
        oscillator: osc,
        note: note,
        startTime: now,
        stopped: false
      };
      
      this.allOscillators.push(oscData);
      oscillators.push(osc);
    }
    
    // Connect filter to note gain
    filter.connect(noteGain);
    
    // Envelope
    // Envelope with exponential attack (smoother)
    noteGain.gain.setValueAtTime(0.001, now);  // Start from near-zero
    noteGain.gain.exponentialRampToValueAtTime(0.5, now + 0.03);
    noteGain.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
    
    noteGain.connect(this.masterGain);
    
    // Store in active map (including filter for later reference if needed)
    this.activeOscillators.set(note, { 
      oscillators, 
      noteGain,
      filter,
      startTime: now
    });
  }

  stopNote(note) {
    if (!this.audioContext) return;
    
    const active = this.activeOscillators.get(note);
    if (!active) return;
    
    const { oscillators, noteGain } = active;
    const now = this.audioContext.currentTime;
    const releaseTime = 4;
    
    try {
      // Release envelope
      noteGain.gain.cancelScheduledValues(now);
      noteGain.gain.setValueAtTime(noteGain.gain.value, now);
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);
      
      // Stop all oscillators and mark them as stopped in global list
      oscillators.forEach(osc => {
        try {
          osc.stop(now + releaseTime);
          
          // Mark as stopped in global list
          const globalEntry = this.allOscillators.find(o => o.oscillator === osc);
          if (globalEntry) {
            globalEntry.stopped = true;
          }
        } catch (e) {
          console.warn('Oscillator already stopped', e);
        }
      });
    } catch (e) {
      console.warn('Error stopping note:', e);
    }
    
    // Remove from active map
    this.activeOscillators.delete(note);
  }

  // Emergency stop all notes
  panic() {
    console.log('PANIC: Stopping all notes');
    
    // Stop via the Map
    const notes = Array.from(this.activeOscillators.keys());
    notes.forEach(note => this.stopNote(note));
    
    // NUCLEAR: Also force-stop any orphaned oscillators
    this.forceStopAllOscillators();
  }

  // Force stop ALL oscillators that aren't marked as stopped
  forceStopAllOscillators() {
    const now = this.audioContext ? this.audioContext.currentTime : 0;
    let forceStopped = 0;
    
    this.allOscillators.forEach(oscData => {
      if (!oscData.stopped) {
        try {
          oscData.oscillator.stop(now);
          oscData.stopped = true;
          forceStopped++;
        } catch (e) {
          // Already stopped or errored
          oscData.stopped = true;
        }
      }
    });
    
    if (forceStopped > 0) {
      console.log(`Force-stopped ${forceStopped} orphaned oscillators`);
    }
    
    // Periodically clean up old stopped oscillators from the list
    // Keep last 100 for debugging, remove older ones
    if (this.allOscillators.length > 100) {
      this.allOscillators = this.allOscillators.slice(-100);
    }
  }

  // Cleanup any oscillators that should have stopped by now
  // Takes circleStates to avoid stopping intentionally held notes
  cleanupOrphanedOscillators(circleStates = {}) {
    if (!this.audioContext) return;
    
    const now = this.audioContext.currentTime;
    const gracePeriod = 2; // Don't touch notes started in the last 2 seconds
    const cleanupTimeout = 7; // After grace period, wait 7 more seconds (total 9 seconds)
    let cleaned = 0;
    
    this.allOscillators.forEach(oscData => {
      // Skip if already marked as stopped
      if (oscData.stopped) return;
      
      const age = now - oscData.startTime;
      
      // GRACE PERIOD: Don't cleanup notes that just started (protects against race conditions)
      if (age < gracePeriod) return;
      
      // Skip if the note is currently being pressed (intentionally held)
      if (circleStates[oscData.note] === true) return;
      
      // If oscillator has been running for more than grace + timeout and circle is NOT pressed
      // it's probably stuck
      if (age > gracePeriod + cleanupTimeout) {
        try {
          oscData.oscillator.stop(now);
          oscData.stopped = true;
          cleaned++;
          console.warn(`Cleaned up orphaned oscillator for note ${oscData.note} (age: ${age.toFixed(1)}s)`);
        } catch (e) {
          oscData.stopped = true;
        }
      }
    });
    
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} orphaned oscillators`);
    }
  }
}