# Ghost

Demo: [https://ghost3d.vercel.app](https://ghost3d.vercel.app/)

[Open in StackBlitz](https://stackblitz.com/edit/ghost)

Ghost is an early-stage 3D physics engine prototype built with Three.js and Rapier. Its goal is to provide a lightweight, modular vanilla JavaScript game engine / player system that can easily incorporate 3D assets created in tools like Blender.

To have a quick play around with the code (and import your own player model):

1. Open in StackBlitz via the link above
2. Fork the directory (You will need a StackBlitz account)
3. Upload your player model to public/models/
4. Look for the 'path' in the CreatePlayer function in the src/main.js file.
5. Please note, the StackBlitz demo may not be up to date with the files here. You can always come back here and clone this repo etc.

You can also import GLB files and use them as physics objects, either static or dynamic by setting the mass or 'isDynamic: false,'. See src/scenes/scene/exampleSceneThree.js.

For the file to work as a physics objects you need to export the GLB from Blender to include an object named ..._collision which will be used for the physics collider shape.

Otherwise it's still very early days and I would love to have help with this.

Some of the immediate things on my to do list are:

- Getting the player movement is as smooth as possible (resolving stuttering effects etc).
- Mobile player controls (virtual joystick for movement, drag anywhere to orbit the camera, buttons for jump etc).
- A system to pause (and toggle) the main animation loop.
- A system to handle camera clipping, as in a typical 'spring' camera (a general option as well, as an option to apply to specific objects, so some objects may not trigger the camera spring).
- A player animation system.
