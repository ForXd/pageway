import { useEffect, useLayoutEffect } from 'react';

// Server rendering cannot register page tools or acquire a browser lock. Keep
// layout timing in the browser without React 18's server-side layout warnings.
export const useClientLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;
