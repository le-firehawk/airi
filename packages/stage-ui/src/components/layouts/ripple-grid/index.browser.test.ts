import { MotionPlugin } from '@vueuse/motion'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { h } from 'vue'

import RippleGrid from './index.vue'

describe('ripple grid headers', () => {
  it('passes each section to its header and keeps item indexes across sections', async () => {
    const sections = [
      { title: 'Chat', items: [{ id: 'chat', label: 'Chat provider' }] },
      { title: 'Speech', items: [{ id: 'speech', label: 'Speech provider' }] },
    ]
    const onItemClick = vi.fn()
    const header = vi.fn(({ section }: { section: typeof sections[number] }) => h('h2', section.title))
    const screen = await render(RippleGrid<typeof sections[number], typeof sections[number]['items'][number]>, {
      props: {
        sections,
        columns: 1,
        animationInitial: { opacity: 1 },
        animationDuration: 0,
        onItemClick,
      },
      global: { plugins: [MotionPlugin] },
      slots: {
        header,
        item: ({ item }: { item: typeof sections[number]['items'][number] }) => h('span', item.label),
      },
    })

    await expect.element(screen.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('heading', { name: 'Speech', exact: true })).toBeVisible()
    expect(header).toHaveBeenCalledWith({ section: sections[0], index: 0 })
    expect(header).toHaveBeenCalledWith({ section: sections[1], index: 1 })

    await screen.getByText('Speech provider', { exact: true }).click()

    expect(onItemClick).toHaveBeenCalledWith({ item: sections[1].items[0], globalIndex: 1 })
  })

  it('renders flat items without calling the header slot', async () => {
    const items = [{ id: 'flat', label: 'Flat item' }]
    const header = vi.fn(() => h('h2', 'Unexpected header'))
    const screen = await render(RippleGrid<never, typeof items[number]>, {
      props: { items, columns: 1, animationInitial: { opacity: 1 }, animationDuration: 0 },
      global: { plugins: [MotionPlugin] },
      slots: {
        header,
        item: ({ item }: { item: typeof items[number] }) => h('span', item.label),
      },
    })

    await expect.element(screen.getByText('Flat item', { exact: true })).toBeVisible()
    expect(screen.getByRole('heading').query()).toBeNull()
    expect(header).not.toHaveBeenCalled()
  })
})
