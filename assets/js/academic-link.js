(function () {
  if (location.hostname !== "functionhx.github.io") return;
  var link = document.getElementById("academic-nav-link");
  if (link && link.dataset.academicGithub) link.href = link.dataset.academicGithub;
})();
