/** Ramp rates (units of full lock per second) for the digital ◀ ▶ touch steering buttons. */
export const TOUCH_STEER = {
  rise: 4.5,   // toward full lock while held
  flip: 10,    // when switching direction (snap through centre)
  ret: 8,      // back to centre when released (the countersteer assist takes over)
};
