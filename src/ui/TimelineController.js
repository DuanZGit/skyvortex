/**
 * TimelineController — 时间轴播放控制
 *
 * 深度模块：调用者只需 play/pause/seek，内部处理帧预加载、
 * 播放循环、速度控制、纹理热替换回调。
 *
 * 接口：
 *   load(frames) → void
 *   play() / pause() / stop()
 *   seek(index) → void
 *   setSpeed(multiplier) → void
 *   onFrame(callback) → void
 *   getState() → { playing, index, count, speed }
 */

export class TimelineController {
  /** @type {Array<{timestamp: string, data: any}>} */
  #frames = [];
  #index = 0;
  #playing = false;
  #speed = 1;          // 1x = 每 500ms 一帧
  #timer = null;
  #intervalMs = 500;
  /** @type {Array<(index: number, frame: any) => void>} */
  #listeners = [];

  /**
   * 加载帧序列
   * @param {Array<{timestamp: string, data: any}>} frames
   */
  load(frames) {
    this.stop();
    this.#frames = frames;
    this.#index = 0;
    this.#emit();
  }

  /** @returns {number} 总帧数 */
  get count() { return this.#frames.length; }

  /** @returns {number} 当前帧索引 */
  get index() { return this.#index; }

  /** @returns {string|null} 当前帧时间戳 */
  get currentTime() {
    return this.#frames[this.#index]?.timestamp || null;
  }

  /** 播放 */
  play() {
    if (this.#playing || this.#frames.length === 0) return;
    this.#playing = true;
    this.#scheduleNext();
  }

  /** 暂停 */
  pause() {
    this.#playing = false;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
  }

  /** 停止并回到第一帧 */
  stop() {
    this.pause();
    this.#index = 0;
    this.#emit();
  }

  /**
   * 跳到指定帧
   * @param {number} index
   */
  seek(index) {
    this.#index = clamp(index, 0, this.#frames.length - 1);
    this.#emit();
  }

  /** 前进一帧 */
  stepForward() {
    this.seek(this.#index + 1);
  }

  /** 后退一帧 */
  stepBackward() {
    this.seek(this.#index - 1);
  }

  /**
   * 设置播放速度
   * @param {number} multiplier - 0.5x / 1x / 2x / 4x
   */
  setSpeed(multiplier) {
    this.#speed = multiplier;
    if (this.#playing) {
      // 重新调度以应用新速度
      if (this.#timer) clearTimeout(this.#timer);
      this.#scheduleNext();
    }
  }

  /**
   * 注册帧变化回调
   * @param {(index: number, frame: any) => void} cb
   * @returns {() => void} 取消注册
   */
  onFrame(cb) {
    this.#listeners.push(cb);
    return () => {
      this.#listeners = this.#listeners.filter(l => l !== cb);
    };
  }

  /** @returns {{playing: boolean, index: number, count: number, speed: number, time: string|null}} */
  getState() {
    return {
      playing: this.#playing,
      index: this.#index,
      count: this.#frames.length,
      speed: this.#speed,
      time: this.currentTime,
    };
  }

  #scheduleNext() {
    if (!this.#playing) return;
    const delay = this.#intervalMs / this.#speed;
    this.#timer = setTimeout(() => {
      if (!this.#playing) return;
      this.#index++;
      if (this.#index >= this.#frames.length) {
        this.#index = 0; // 循环播放
      }
      this.#emit();
      this.#scheduleNext();
    }, delay);
  }

  #emit() {
    const frame = this.#frames[this.#index];
    for (const cb of this.#listeners) {
      cb(this.#index, frame);
    }
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}