import type { ReactElement } from 'react'
import styles from './sftp.module.scss'
import { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'

interface Props {
  msg: string
  onClick: () => void
  t: TFunction<'translation', undefined>
}

const SFTPView = ({ msg, onClick, t }: Props): ReactElement => (
  <div>
    <h1>{t('demo.Welcome to React')}</h1>
    <h1 className={styles.text}>{msg}</h1>
    <Button onClick={onClick}>click</Button>
  </div>
)
export default SFTPView
