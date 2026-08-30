import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'

const root = document.getElementById('root')
if (root === null) throw new Error('no #root in index.html')
createRoot(root).render(<App />)
