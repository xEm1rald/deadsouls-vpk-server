(function() {
  const navEntries = performance.getEntriesByType("navigation");
  if (navEntries.length > 0 && navEntries[0].type === "reload") {
    document.documentElement.classList.add("prevent-animation");
  }
})();