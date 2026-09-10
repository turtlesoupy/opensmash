# Character inspection fixtures

Local development previews for the Thomas Dimson character. From `web-prototype`,
run `pnpm exec vite --host 127.0.0.1` and open the address printed by Vite with:

- `/tools/character-inspection/character-preview.html` — download/settings modal
  using a completed mock job and the saved OSB6 bundle. Settings changes are local
  React state; deletion is a no-op.
- `/tools/character-inspection/obj-inspection.html` — exported OBJ with its MTL and
  PNG texture, orbit controls, wireframe toggle, and camera reset.

`assets/` holds the saved bundle and exported model files. Keep the OBJ, MTL, and
texture together so their relative references resolve. These pages are development
entry points and are not added to the production Vite build.
