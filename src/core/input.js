/**
 * 输入系统：键盘、鼠标、指针锁定。
 * @module core/input
 */
export class Input {
  /** @param {HTMLElement} domElement */
  constructor(domElement) {
    this.dom = domElement;
    /** @type {Set<string>} 当前按下的键 */
    this.keys = new Set();
    /** @type {Set<string>} 本帧新按下的键 */
    this.pressed = new Set();
    /** @type {boolean[]} */
    this.buttons = [false, false, false];
    /** @type {boolean[]} 本帧新按下的鼠标键 */
    this.buttonPressed = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    /** @type {(() => void)|null} */
    this.onLockChange = null;
    /** @type {((code:string)=>void)|null} */
    this.onKeyPress = null;
    this.enabled = true;

    this._onKeyDown = (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        if (this.onKeyPress) this.onKeyPress(e.code);
      }
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button < 3) {
        if (!this.buttons[e.button]) this.buttonPressed[e.button] = true;
        this.buttons[e.button] = true;
      }
    };
    this._onMouseUp = (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onWheel = (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    };
    this._onPointerLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) {
        this.keys.clear();
        this.buttons = [false, false, false];
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._onBlur = () => {
      this.keys.clear();
      this.buttons = [false, false, false];
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  /** 请求指针锁定。 */
  requestLock() {
    if (this.locked) return;
    const p = this.dom.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /** 解除指针锁定。 */
  exitLock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  /** @param {string} code */
  down(code) {
    return this.keys.has(code);
  }

  /** @param {string} code */
  justPressed(code) {
    return this.pressed.has(code);
  }

  /** 每帧末尾调用，清空瞬时状态。 */
  endFrame() {
    this.pressed.clear();
    this.buttonPressed = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
