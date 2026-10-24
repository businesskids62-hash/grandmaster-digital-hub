/* ==========================================================================
   DOUBLE BRAIN — Connects Hamzad + SystemDimagh
   Activated on wake word "Mere Sher".
   ========================================================================== */

import { hamzad } from "./hamzad.js";
import { systemDimagh } from "./systemDimagh.js";

class DoubleBrain {
  constructor(hamzadInstance, dimaghInstance) {
    this.hamzad = hamzadInstance;
    this.dimagh = dimaghInstance;
    this.active = false;
    this.triggeredAt = null;
  }

  /* ---- activate both brains on wake word ---- */
  activate() {
    this.active = true;
    this.triggeredAt = Date.now();

    const hamzadState = this.hamzad.activate();
    const dimaghState = this.dimagh.activate();

    // Log activation in dimagh
    this.dimagh.addLog("Wake word 'Mere Sher' detected — both brains activated", "wake");

    console.log("[MERE SHER] Triggered -> [Hamzad] Zinda -> [Dimagh] Zinda");

    return {
      triggered: true,
      triggeredAt: this.triggeredAt,
      hamzad: hamzadState,
      dimagh: dimaghState,
    };
  }

  /* ---- deactivate both brains ---- */
  deactivate() {
    this.active = false;
    this.triggeredAt = null;
    this.hamzad.deactivate();
    this.dimagh.deactivate();
    this.dimagh.addLog("Brains deactivated", "info");
    return { triggered: false };
  }

  /* ---- status ---- */
  getStatus() {
    return {
      active: this.active,
      triggeredAt: this.triggeredAt,
      hamzad: this.hamzad.getSnapshot(),
      dimagh: this.dimagh.getSnapshot(),
    };
  }

  isActive() {
    return this.active;
  }
}

export const doubleBrain = new DoubleBrain(hamzad, systemDimagh);
export default doubleBrain;
export { DoubleBrain };
