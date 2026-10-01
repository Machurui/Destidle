import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SplashFrame from '../SplashFrame.vue'
import { i18n, setLocale } from '@/i18n'

function mountSplash(props: { src: string | null; level: number }) {
  return mount(SplashFrame, { props, global: { plugins: [i18n] } })
}

const SRC = '/api/game/splash?token=abc&level=3'

describe('SplashFrame', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('fr')
  })

  it('renders the image with the exact src, an empty alt and no dragging', () => {
    const wrapper = mountSplash({ src: SRC, level: 3 })
    const img = wrapper.find('img.splash-canvas')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe(SRC)
    expect(img.attributes('alt')).toBe('')
    expect(img.attributes('draggable')).toBe('false')
  })

  it('keeps the frame and the four corners without an image when src is null', () => {
    const wrapper = mountSplash({ src: null, level: 0 })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.splash-stage > .splash-frame').exists()).toBe(true)
    const corners = wrapper.findAll('.splash-corners > .cnr')
    expect(corners).toHaveLength(4)
    expect(corners.map((c) => c.classes()).map((cls) => cls.filter((c) => c !== 'cnr')[0])).toEqual([
      'tl',
      'tr',
      'bl',
      'br',
    ])
  })

  it('sizes the frame to 360px', () => {
    const frame = mountSplash({ src: SRC, level: 0 }).find('.splash-frame').element as HTMLElement
    expect(frame.style.width).toBe('360px')
    expect(frame.style.height).toBe('360px')
  })

  it.each([
    [0, 1],
    [4, 5],
    [9, 10],
  ])('lights level + 1 ticks out of 10 for level %i', (level, lit) => {
    const wrapper = mountSplash({ src: SRC, level })
    expect(wrapper.findAll('.splash-bar > .bar-tick')).toHaveLength(10)
    expect(wrapper.findAll('.bar-tick.on')).toHaveLength(lit)
  })

  it('lights the ticks from the left', () => {
    const ticks = mountSplash({ src: SRC, level: 2 }).findAll('.bar-tick')
    expect(ticks.map((t) => t.classes('on'))).toEqual([
      true, true, true, false, false, false, false, false, false, false,
    ])
  })

  it('marks the frame as revealed at level 9 only', () => {
    expect(mountSplash({ src: SRC, level: 8 }).find('.splash-frame').classes('revealed')).toBe(false)
    expect(mountSplash({ src: SRC, level: 9 }).find('.splash-frame').classes('revealed')).toBe(true)
  })

  it('shows the SIGNAL chrome tag', () => {
    expect(mountSplash({ src: SRC, level: 0 }).find('.splash-overlay > .splash-tag').text()).toBe('SIGNAL')
  })
})
