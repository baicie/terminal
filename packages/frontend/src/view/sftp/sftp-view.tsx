import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import styles from './sftp.module.scss'

interface Props {
  msg: string
  onClick: () => void
  t: TFunction<'translation', undefined>
}

function SFTPView({ msg, onClick, t }: Props): ReactElement {
  return (
    <div>
      <h1>{t('demo.Welcome to React')}</h1>
      <h1 className={styles.text}>{msg}</h1>
      <Button onClick={onClick}>click</Button>
    </div>
  )
}
export default SFTPView
