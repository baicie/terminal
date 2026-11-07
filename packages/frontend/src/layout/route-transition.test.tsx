import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { Link, MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { RouteTransition } from './route-transition'

// The regression this guards: RouteTransition used to keep the pathname in
// state and update it from an effect. After a navigation the first render
// still used the previous key, so the new route mounted once under the old
// container and then again under the new one. Users saw the page flash (and a
// lazy route load twice); this counter turns that into a test failure.
const mounts = { a: 0, b: 0 }

function Probe({ label }: { label: 'a' | 'b' }) {
  useEffect(() => {
    mounts[label] += 1
  }, [label])
  return <div>page-{label}</div>
}

function Layout() {
  return (
    <RouteTransition>
      <Link to="/b">go-b</Link>
      <Outlet />
    </RouteTransition>
  )
}

describe('route transition', () => {
  beforeEach(() => {
    mounts.a = 0
    mounts.b = 0
  })

  it('mounts the new route exactly once and keeps the layer opaque', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/a']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/a" element={<Probe label="a" />} />
            <Route path="/b" element={<Probe label="b" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('page-a')).toBeTruthy()
    expect(mounts.a).toBe(1)

    fireEvent.click(screen.getByText('go-b'))

    expect(await screen.findByText('page-b')).toBeTruthy()
    expect(mounts.b).toBe(1)
    const layer = container.querySelector('.route-transition-layer')
    expect(layer?.className).toContain('bg-background')
  })
})
