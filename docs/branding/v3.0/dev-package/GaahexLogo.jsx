import React from "react";
const C={cobalt:"#1C3B68",lift:"#4E7FC4",gold:"#C5A059",azure:"#0EA5E9",white:"#FFFFFF",ink:"#0B0B0C"};
// Line-free GAAhex mark (v3.0: filled cells, two azure signal hexagons, gold destination) + wordmark. mode: "color"|"dark"|"white"|"black"
export default function GaahexLogo({mode="color",showWordmark=true,height=48}){
  const cell = mode==="dark"?C.lift: mode==="white"?C.white: mode==="black"?C.ink: C.cobalt;
  const tip  = mode==="white"?C.white: mode==="black"?C.ink: C.gold;
  // import the SVG asset for production; this is a thin wrapper example
  const src = showWordmark ? `/gaahex-logo-horizontal-${mode}.svg` : `/gaahex-icon-${mode}.svg`;
  return <img src={src} alt="GAAhex" style={{height}} />;
}
