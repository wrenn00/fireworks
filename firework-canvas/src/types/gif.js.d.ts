declare module 'gif.js' {
  interface GIFOptions {
    workers?: number
    quality?: number
    width?: number
    height?: number
    workerScript?: string
    background?: string
    transparent?: string | null
    repeat?: number   // 0 = loop forever, -1 = no repeat
    debug?: boolean
  }

  interface AddFrameOptions {
    delay?: number
    copy?: boolean
    dispose?: number
  }

  class GIF {
    constructor(options: GIFOptions)
    addFrame(
      source: HTMLCanvasElement | CanvasRenderingContext2D | ImageData,
      options?: AddFrameOptions,
    ): void
    on(event: 'finished', cb: (blob: Blob) => void): void
    on(event: 'progress', cb: (progress: number) => void): void
    render(): void
    abort(): void
  }

  export default GIF
}

// Vite ?url import
declare module 'gif.js/dist/gif.worker.js?url' {
  const url: string
  export default url
}
