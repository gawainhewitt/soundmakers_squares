<script>
  import { onMount, onDestroy } from 'svelte';
  import Circle from './Circle.svelte';
  import { ScaleGenerator } from './ScaleGenerator.js';
  
  export let audioEngine;
  export let scaleConfig = { key: 'C', scale: 'major', octave: 4 };
  
  let circles = Array.from({ length: 9 }, function(_, i) { return i; });
  let orientation = 'portrait';
  let cleanupInterval;
  let scaleGenerator = new ScaleGenerator();
  
  // Generate scale based on configuration
  let scale = [];
  $: {
    scale = scaleGenerator.generateScale(
      scaleConfig.key,
      scaleConfig.scale,
      scaleConfig.octave
    );
    console.log('Generated scale:', scale);
    
    // Reset circle states when scale changes
    resetCircleStates();
  }
  
  // Map keyboard keys to circle indices
  var keyMap = {
    'z': 0,
    'x': 1,
    'c': 2,
    'v': 3,
    'b': 4,
    'n': 5,
    'm': 6,
    ',': 7,
    '.': 8
  };
  
  // Track which circles are pressed
  let circleStates = {};
  
  function resetCircleStates() {
    circleStates = {};
    circles.forEach(function(_, i) {
      if (scale[i]) {
        circleStates[scale[i]] = false;
      }
    });
  }
  
  // Track which keys are currently held down (prevent key repeat)
  let heldKeys = new Set();
  
  onMount(() => {
    // Initialize circle states
    resetCircleStates();
    
    // Periodic cleanup - check for orphaned oscillators
    cleanupInterval = setInterval(function() {
      if (audioEngine) {
        // First do smart cleanup based on circle states
        smartCleanup();
        // Then do nuclear cleanup of any orphaned oscillators (passing circle states)
        audioEngine.cleanupOrphanedOscillators(circleStates);
      }
    }, 1000); // Check every 1 second
    
    // Add global panic button and keyboard handlers
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', handleKeyup);
    
    // Stop all notes when page loses focus or visibility
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
  });
  
  onDestroy(() => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('keyup', handleKeyup);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    
    // Panic on unmount
    if (audioEngine) {
      audioEngine.panic();
    }
  });
  
  function handleVisibilityChange() {
    if (document.hidden && audioEngine) {
      console.log('Page hidden - stopping all notes');
      audioEngine.panic();
      // Reset all circle states
      Object.keys(circleStates).forEach(function(note) {
        circleStates[note] = false;
      });
      heldKeys.clear();
    }
  }
  
  function handleWindowBlur() {
    if (audioEngine) {
      console.log('Window blur - stopping all notes');
      audioEngine.panic();
      // Reset all circle states
      Object.keys(circleStates).forEach(function(note) {
        circleStates[note] = false;
      });
      heldKeys.clear();
    }
  }
  
  function smartCleanup() {
    // Get all currently playing notes
    var playingNotes = Array.from(audioEngine.activeOscillators.keys());
    
    // Stop any notes that are playing but their circle is not pressed
    playingNotes.forEach(function(note) {
      if (!circleStates[note]) {
        console.warn('Cleaning up stuck note:', note);
        audioEngine.stopNote(note);
      }
    });
  }
  
  function handleKeydown(e) {
    // Press 'P' key to panic (stop all notes)
    if (e.key === 'p' || e.key === 'P') {
      if (audioEngine) {
        audioEngine.panic();
        // Reset all circle states
        Object.keys(circleStates).forEach(function(note) {
          circleStates[note] = false;
        });
        heldKeys.clear();
      }
      return;
    }
    
    // Handle instrument keys (zxcvbnm,.)
    var key = e.key.toLowerCase();
    if (keyMap.hasOwnProperty(key)) {
      // Prevent key repeat - only trigger on first press
      if (heldKeys.has(key)) return;
      heldKeys.add(key);
      
      var circleIndex = keyMap[key];
      var note = scale[circleIndex];
      
      // Trigger press
      circleStates[note] = true;
      if (audioEngine) {
        audioEngine.playNote(note);
      }
      console.log('Key pressed:', key, '→', note);
    }
  }
  
  function handleKeyup(e) {
    var key = e.key.toLowerCase();
    if (keyMap.hasOwnProperty(key)) {
      heldKeys.delete(key);
      
      var circleIndex = keyMap[key];
      var note = scale[circleIndex];
      
      // Trigger release
      circleStates[note] = false;
      if (audioEngine) {
        audioEngine.stopNote(note);
      }
      console.log('Key released:', key, '→', note);
    }
  }
  
  async function initAudio() {
    // Audio should already be initialized from splash screen
    // But we can resume if suspended
    if (audioEngine && audioEngine.audioContext && audioEngine.audioContext.state === 'suspended') {
      await audioEngine.audioContext.resume();
      console.log('Audio context resumed:', audioEngine.audioContext.state);
    }
  }
  
  function updateOrientation() {
    orientation = window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
  }
  
  $: {
    if (typeof window !== 'undefined') {
      updateOrientation();
    }
  }
  
  async function handlePress(event) {
    await initAudio();
    circleStates[event.detail.note] = true;
    console.log('Circle pressed:', event.detail.note);
  }
  
  function handleRelease(event) {
    circleStates[event.detail.note] = false;
    console.log('Circle released:', event.detail.note);
  }
</script>

<svelte:window on:resize={updateOrientation} />

<div class="container {orientation}">
  {#each circles as index}
    <Circle 
      {index}
      {orientation}
      {audioEngine}
      note={scale[index]}
      isPressed={circleStates[scale[index]]}
      on:press={handlePress}
      on:release={handleRelease}
    />
  {/each}
</div>

<style>
  .container {
    display: grid;
    gap: 2vh;
    padding: 7vh 2vh 2vh 2vh;
    height: 100%;
    width: 100%;
    place-items: center;
    place-content: center;
  }
  
  .container.portrait {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }
  
  .container.landscape {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }
</style>
