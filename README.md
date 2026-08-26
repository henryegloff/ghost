# Ghost

Demo: [https://ghost3d.vercel.app](https://ghost3d.vercel.app/)

[Open in Code Sandbox](https://codesandbox.io/p/devbox/3357f9?file=%2Fsrc%2Fmain.js%3A19%2C20)

Ghost is an early-stage 3D physics engine prototype built with Three.js and Rapier. Its goal is to provide a lightweight, modular vanilla JavaScript game engine / system that can easily incorporate 3D assets created in tools like Blender.

To have a quick play around with the code (and import your own player model):

1. Open in CodeSandbox via the link above
2. Fork the directory (You will need a CodeSandbox account)
2. Upload your player model to public/models/
2. Update the path to your model in src/main.js file

# Running This Project on Your Computer

This guide assumes you've never used these tools before and that you are relatively new Github and NPM etc.

## 1. Install the tools you'll need

### A code editor: e.g. VS Code

This is the program you'll use to look at and edit the code.

- Download it from **https://code.visualstudio.com**
- Run the installer, keeping the default options.

### Git

Git is what lets you download ("clone") a project from GitHub, and keep
it updated later.

- Download it from **https://git-scm.com/downloads**
- Run the installer, keeping the default options (it's fine to click
  "Next" through all of them if you're unsure).
- To check it worked: open a terminal (see box below) and type:

  ```
  git --version
  ```

  You should see something like `git version 2.43.0`. If you instead see
  an error like "command not found", restart your computer and try again
  — Git needs a fresh terminal to pick up its installation.

> **What's a terminal?**
> It's a text-based way to give your computer instructions, instead of
> clicking icons. On **Windows**, search for and open "Command Prompt" or
> "PowerShell". On **Mac**, search for and open "Terminal" (use
> Spotlight: Cmd+Space, then type "Terminal"). You'll type commands and
> press Enter to run them.

### Node.js (this also installs npm)

Node.js lets you run the tools that build and preview the project.
Installing it also installs **npm**, which downloads all the code
libraries the project depends on (things like the 3D graphics engine).

- Go to **https://nodejs.org**
- Download the version labeled **LTS** (this stands for "Long Term
  Support" — it's the stable, recommended one). Avoid the "Current"
  version.
- Run the installer, keeping the default options.
- To check it worked, open a terminal and type:

  ```
  node --version
  ```

  and

  ```
  npm --version
  ```

  Each should print a version number (e.g. `v20.11.0` and `10.2.4`). If
  either says "command not found", restart your computer and try again.

## 2. Download the project

1. Open a terminal.
2. Decide where on your computer you want the project folder to live,
   e.g. your Documents folder. Move the terminal there with `cd`
   (short for "change directory"). For example:

   ```
   cd Documents
   ```

3. Copy the project's GitHub URL — on the repository's GitHub page,
   click the green **Code** button and copy the HTTPS link (it ends in
   `.git`).
4. In the terminal, type `git clone` followed by a space, then paste the
   link, then press Enter:

   ```
   git clone https://github.com/henryegloff/ghost.git
   ```

   This creates a new folder containing all the project's files.

## 3. Open the project in VS Code

1. Open VS Code.
2. Go to **File → Open Folder…**
3. Select the folder that `git clone` just created.

## 4. Install the project's dependencies

The project relies on several external code libraries (for 3D graphics,
physics, sound, etc.) that aren't included in the GitHub download — you
need to fetch them yourself, once, before it will run.

1. In VS Code, open the built-in terminal: **Terminal → New Terminal**
   (or press `` Ctrl+` `` / `` Cmd+` ``). This opens a terminal already
   pointed at your project folder, so you don't need to `cd` anywhere.
2. Type:

   ```
   npm install
   ```

   and press Enter. This downloads everything the project needs into a
   folder called `node_modules`. It can take a minute or two — that's
   normal. You'll see a lot of text scroll by; as long as it ends without
   a red "npm ERR!" message, it worked.

## 5. Run the project

1. In the same terminal, type:

   ```
   npm run dev
   ```

   and press Enter. This starts a "dev server" — a small local website
   serving your project.
2. The terminal will print a URL, usually something like
   `http://localhost:5173/`. Hold Ctrl (or Cmd on Mac) and click it, or
   copy it into your browser's address bar.
3. You should see the project running in your browser.

To stop the dev server, click back into the terminal and press
`Ctrl+C`.

## 6. Making changes

With the dev server running, any time you edit and save a file in VS
Code, the browser will automatically update to reflect your change — no
need to restart anything.

## Troubleshooting

**"npm: command not found" or "node: command not found"**
Node.js isn't installed correctly, or you opened a terminal before
installing it. Reinstall Node.js from nodejs.org, then close and reopen
your terminal.

**`npm install` ends with red "npm ERR!" text**
Scroll up to read the first error — it usually names a specific package.
Try deleting the `node_modules` folder and the `package-lock.json` file
(if one exists) from the project folder, then run `npm install` again.

**The browser shows an error instead of the project**
Check the terminal running `npm run dev` — error details usually show up
there first, before they show in the browser.

**Port already in use**
If you see a message about a port being "in use", another program (maybe
another copy of this dev server) is already running. Close other
terminal windows running `npm run dev`, or restart your computer.
