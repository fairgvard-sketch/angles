import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  heroVideoTargetSize,
  selectHeroVideoRecorderType,
} from './hero-video'

describe('hero video optimization', () => {
  it('keeps an already mobile-sized portrait video', () => {
    assert.deepEqual(heroVideoTargetSize(404, 720), { width: 404, height: 720 })
  })

  it('caps large video dimensions and keeps even encoder sizes', () => {
    assert.deepEqual(heroVideoTargetSize(1080, 1920), { width: 406, height: 720 })
    assert.deepEqual(heroVideoTargetSize(1920, 1080), { width: 720, height: 406 })
  })

  it('prefers H.264 MP4 and falls back to WebM', () => {
    assert.equal(
      selectHeroVideoRecorderType((type) => type === 'video/mp4;codecs=avc1.42E01E'),
      'video/mp4;codecs=avc1.42E01E',
    )
    assert.equal(
      selectHeroVideoRecorderType((type) => type === 'video/webm;codecs=vp8'),
      'video/webm;codecs=vp8',
    )
  })
})
