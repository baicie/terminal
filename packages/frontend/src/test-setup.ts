// Components call useTranslation directly; without initialising the shared
// i18n instance in tests they would render key names instead of copy. Every
// test therefore starts on English, and the few tests that switch language
// (vaults, dialogs) still call changeLanguage themselves.
import i18n from '@/locales'

await i18n.changeLanguage('en')
