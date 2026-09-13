export const HERO_VIDEO_INPUT_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' }
export const HERO_VIDEO_MAX_INPUT_BYTES = 30 * 1024 * 1024
export const HERO_VIDEO_MAX_DURATION_SECONDS = 30
export const HERO_VIDEO_PASSTHROUGH_BYTES = 1.5 * 1024 * 1024
export const HERO_VIDEO_TARGET_LONG_EDGE = 720
export const HERO_VIDEO_TARGET_BITRATE = 900_000

const RECORDER_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

export function heroVideoTargetSize(width, height, longEdge = HERO_VIDEO_TARGET_LONG_EDGE) {
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  }
}

export function selectHeroVideoRecorderType(isSupported) {
  return RECORDER_TYPES.find((type) => isSupported(type)) || null
}

function waitForMedia(video, event) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, onReady)
      video.removeEventListener('error', onError)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Could not read this video'))
    }
    video.addEventListener(event, onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

/**
 * Re-encodes oversized hero videos in real time before upload. The canvas
 * stream intentionally contains no audio track: public heroes are muted, and
 * removing audio saves bytes on every guest visit.
 */
export async function optimizeHeroVideo(file, onProgress = () => {}) {
  if (!HERO_VIDEO_INPUT_TYPES[file.type]) {
    throw new Error('Only MP4 and WebM videos are supported')
  }
  if (file.size > HERO_VIDEO_MAX_INPUT_BYTES) {
    throw new Error('Video must be 30 MB or smaller')
  }

  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true

  let stream
  let drawFrame = 0
  let progressTimer
  let recorder

  try {
    const metadataLoaded = waitForMedia(video, 'loadedmetadata')
    video.src = objectUrl
    await metadataLoaded
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not read this video duration')
    }
    if (duration > HERO_VIDEO_MAX_DURATION_SECONDS) {
      throw new Error('Video must be 30 seconds or shorter')
    }

    if (file.size <= HERO_VIDEO_PASSTHROUGH_BYTES) {
      onProgress(100)
      return file
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser cannot optimize video. Try the latest Chrome or Safari.')
    }

    const mimeType = selectHeroVideoRecorderType((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) {
      throw new Error('This browser cannot create a compatible MP4 or WebM video')
    }

    if (video.readyState < 2) {
      const firstFrameLoaded = waitForMedia(video, 'loadeddata')
      video.preload = 'auto'
      video.load()
      await firstFrameLoaded
    }
    const canvas = document.createElement('canvas')
    const target = heroVideoTargetSize(video.videoWidth, video.videoHeight)
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context || typeof canvas.captureStream !== 'function') {
      throw new Error('This browser cannot optimize video. Try the latest Chrome or Safari.')
    }

    stream = canvas.captureStream(24)
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: HERO_VIDEO_TARGET_BITRATE,
    })
    const chunks = []
    const recorded = new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunks.push(event.data)
      })
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mimeType })), {
        once: true,
      })
      recorder.addEventListener('error', () => reject(new Error('Video optimization failed')), {
        once: true,
      })
    })

    const paint = () => {
      context.drawImage(video, 0, 0, target.width, target.height)
      if (!video.ended) drawFrame = requestAnimationFrame(paint)
    }
    context.drawImage(video, 0, 0, target.width, target.height)
    recorder.start(250)
    paint()
    progressTimer = window.setInterval(() => {
      onProgress(Math.min(99, Math.round((video.currentTime / duration) * 100)))
    }, 200)

    const ended = waitForMedia(video, 'ended')
    await video.play()
    await ended
    recorder.stop()
    const blob = await recorded
    onProgress(100)

    const outputType = blob.type.split(';')[0]
    const extension = outputType === 'video/mp4' ? 'mp4' : 'webm'
    return new File([blob], `hero-optimized.${extension}`, {
      type: outputType,
      lastModified: Date.now(),
    })
  } finally {
    if (recorder?.state === 'recording') recorder.stop()
    if (drawFrame) cancelAnimationFrame(drawFrame)
    if (progressTimer) window.clearInterval(progressTimer)
    stream?.getTracks().forEach((track) => track.stop())
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}
